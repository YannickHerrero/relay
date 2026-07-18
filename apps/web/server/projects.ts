import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { projectConfigVersions, projects } from "@relay/db";
import { projectTypeSchema } from "@relay/domain";
import { loadProjectConfig } from "@relay/project-config";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { database } from "./database";
import {
  availableProjectDirectory,
  existingProjectDirectory,
  projectDirectoryNameSchema,
} from "./project-directory";

const execFileAsync = promisify(execFile);

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  directoryName: projectDirectoryNameSchema,
  defaultBranch: z.string().trim().min(1).max(200).default("main"),
  projectType: projectTypeSchema,
});

export async function createProject(input: z.infer<typeof projectInputSchema>) {
  const values = projectInputSchema.parse(input);
  const repositoryPath = await existingProjectDirectory(values.directoryName);
  await verifyRepository(repositoryPath, values.defaultBranch);
  return persistProject(values, repositoryPath);
}

export async function createNewProject(input: z.infer<typeof projectInputSchema>) {
  const values = projectInputSchema.parse(input);
  const repositoryPath = await initializeProjectRepository(values);
  return persistProject(values, repositoryPath);
}

export async function initializeProjectRepository(
  input: z.infer<typeof projectInputSchema>,
): Promise<string> {
  const values = projectInputSchema.parse(input);
  await verifyBranchName(values.defaultBranch);
  const repositoryPath = await availableProjectDirectory(values.directoryName);
  await mkdir(repositoryPath);
  try {
    await execFileAsync("git", ["init", "-b", values.defaultBranch, repositoryPath]);
    const title = values.name.replace(/\s+/g, " ");
    await writeFile(join(repositoryPath, "README.md"), `# ${title}\n`);
    await execFileAsync("git", ["-C", repositoryPath, "add", "README.md"]);
    await execFileAsync("git", [
      "-C",
      repositoryPath,
      "-c",
      "user.name=Relay",
      "-c",
      "user.email=relay@localhost",
      "commit",
      "-m",
      "chore: initialize project",
    ]);
    return repositoryPath;
  } catch (error) {
    await rm(repositoryPath, { recursive: true, force: true });
    throw new Error("Unable to initialize the Git repository", { cause: error });
  }
}

async function persistProject(
  values: z.infer<typeof projectInputSchema>,
  repositoryPath: string,
): Promise<string> {
  const loaded = await loadProjectConfig(repositoryPath);
  const now = new Date().toISOString();
  const projectId = randomUUID();
  const projectValues = {
    name: values.name,
    defaultBranch: values.defaultBranch,
    projectType: values.projectType,
  };
  const { db, sqlite } = database();

  sqlite.transaction(() => {
    db.insert(projects)
      .values({
        ...projectValues,
        id: projectId,
        repositoryPath,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(projectConfigVersions)
      .values({
        id: randomUUID(),
        projectId,
        version: 1,
        source: loaded.source,
        hash: loaded.hash,
        content: loaded.config,
        createdAt: now,
      })
      .run();
  })();
  return projectId;
}

export async function refreshProjectConfig(projectId: string) {
  const { db, sqlite } = database();
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new Error("Project not found");
  const loaded = await loadProjectConfig(project.repositoryPath);
  const latest = db
    .select()
    .from(projectConfigVersions)
    .where(eq(projectConfigVersions.projectId, projectId))
    .orderBy(desc(projectConfigVersions.version))
    .get();
  if (latest?.hash === loaded.hash) return latest;
  const now = new Date().toISOString();
  const next = {
    id: randomUUID(),
    projectId,
    version: (latest?.version ?? 0) + 1,
    source: loaded.source,
    hash: loaded.hash,
    content: loaded.config,
    createdAt: now,
  };
  sqlite.transaction(() => {
    db.insert(projectConfigVersions).values(next).run();
    db.update(projects).set({ updatedAt: now }).where(eq(projects.id, projectId)).run();
  })();
  return next;
}

async function verifyBranchName(branch: string): Promise<void> {
  try {
    await execFileAsync("git", ["check-ref-format", "--branch", branch]);
  } catch (error) {
    throw new Error(`Invalid Git branch name '${branch}'`, { cause: error });
  }
}

export async function verifyRepository(path: string, branch: string): Promise<void> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", path, "rev-parse", "--show-toplevel"]);
    if ((await realpath(stdout.trim())) !== (await realpath(path))) {
      throw new Error("Path must be the root of a Git repository");
    }
    await execFileAsync("git", ["-C", path, "rev-parse", "--verify", branch]);
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.startsWith("Path must")
        ? error.message
        : `Unable to verify Git repository and branch '${branch}'`,
      { cause: error },
    );
  }
}
