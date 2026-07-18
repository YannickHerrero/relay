import { execFile } from "node:child_process";
import { access, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";

import type { projectTypeSchema } from "@relay/domain";
import { z } from "zod";

import { relayProjectsDir } from "./runtime";

const execFileAsync = promisify(execFile);

export const projectDirectoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (value) =>
      value !== "." &&
      value !== ".." &&
      !value.startsWith(".") &&
      basename(value) === value &&
      !value.includes("\0"),
    "Directory name must be one visible folder name without path separators",
  );

export type DiscoveredProject = {
  directoryName: string;
  repositoryPath: string;
  isGitRepository: boolean;
  defaultBranch: string | null;
  projectType: z.infer<typeof projectTypeSchema>;
  registeredProjectId: string | null;
};

export async function projectRootDirectory(): Promise<string> {
  const configured = relayProjectsDir();
  await mkdir(configured, { recursive: true });
  return realpath(configured);
}

export async function existingProjectDirectory(directoryName: string): Promise<string> {
  const name = projectDirectoryNameSchema.parse(directoryName);
  const root = await projectRootDirectory();
  const path = await realpath(join(/* turbopackIgnore: true */ root, name));
  assertDirectChild(root, path);
  return path;
}

export async function availableProjectDirectory(directoryName: string): Promise<string> {
  const name = projectDirectoryNameSchema.parse(directoryName);
  const root = await projectRootDirectory();
  const path = join(/* turbopackIgnore: true */ root, name);
  assertDirectChild(root, path);
  try {
    await access(path);
    throw new Error(`A folder named '${name}' already exists`);
  } catch (error) {
    if (isMissingFileError(error)) return path;
    throw error;
  }
}

export async function scanProjectDirectories(
  registeredPaths: ReadonlyMap<string, string> = new Map(),
): Promise<{ root: string; projects: DiscoveredProject[] }> {
  const root = await projectRootDirectory();
  const entries = await readdir(root, { withFileTypes: true });
  const projects = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map(async (entry): Promise<DiscoveredProject> => {
        const repositoryPath = await realpath(join(/* turbopackIgnore: true */ root, entry.name));
        assertDirectChild(root, repositoryPath);
        const git = await inspectGitRepository(repositoryPath);
        return {
          directoryName: entry.name,
          repositoryPath,
          isGitRepository: git.isRepository,
          defaultBranch: git.defaultBranch,
          projectType: await detectProjectType(repositoryPath),
          registeredProjectId: registeredPaths.get(repositoryPath) ?? null,
        };
      }),
  );
  projects.sort((left, right) => left.directoryName.localeCompare(right.directoryName));
  return { root, projects };
}

async function inspectGitRepository(
  path: string,
): Promise<{ isRepository: boolean; defaultBranch: string | null }> {
  try {
    const { stdout: topLevel } = await execFileAsync("git", [
      "-C",
      path,
      "rev-parse",
      "--show-toplevel",
    ]);
    if ((await realpath(topLevel.trim())) !== path) {
      return { isRepository: false, defaultBranch: null };
    }
    const { stdout: branch } = await execFileAsync("git", [
      "-C",
      path,
      "symbolic-ref",
      "--short",
      "HEAD",
    ]);
    return { isRepository: true, defaultBranch: branch.trim() || "main" };
  } catch {
    return { isRepository: false, defaultBranch: null };
  }
}

async function detectProjectType(path: string): Promise<z.infer<typeof projectTypeSchema>> {
  if (await exists(join(path, "Cargo.toml"))) return "rust";
  const entries = await readdir(path);
  if (entries.some((entry) => entry.endsWith(".xcodeproj") || entry.endsWith(".xcworkspace"))) {
    return "ios";
  }
  const packagePath = join(path, "package.json");
  if (await exists(packagePath)) {
    try {
      const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
      if ("expo" in dependencies || "react-native" in dependencies) return "expo";
    } catch {
      // A malformed package manifest is still most likely a web project.
    }
    return "web";
  }
  return "custom";
}

function assertDirectChild(root: string, path: string): void {
  const relativePath = relative(root, path);
  if (!relativePath || isAbsolute(relativePath) || dirname(relativePath) !== ".") {
    throw new Error("Project directory must be an immediate child of the configured projects root");
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
