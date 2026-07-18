import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { initializeProjectRepository } from "./projects";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  delete process.env.RELAY_PROJECTS_DIR;
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("project creation", () => {
  it("creates a committed Git repository inside the configured project root", async () => {
    const root = await temporaryRoot();

    const repositoryPath = await initializeProjectRepository({
      name: "Created by Relay",
      directoryName: "created-project",
      defaultBranch: "trunk",
      projectType: "web",
    });

    expect(repositoryPath).toBe(join(root, "created-project"));
    expect(await readFile(join(repositoryPath, "README.md"), "utf8")).toBe("# Created by Relay\n");
    expect(
      (
        await execFileAsync("git", ["-C", repositoryPath, "branch", "--show-current"])
      ).stdout.trim(),
    ).toBe("trunk");
    expect(
      (
        await execFileAsync("git", ["-C", repositoryPath, "log", "-1", "--format=%s"])
      ).stdout.trim(),
    ).toBe("chore: initialize project");
  });

  it("rejects duplicate folders, traversal, and invalid branch names", async () => {
    await temporaryRoot();
    const validInput = {
      name: "Safe project",
      directoryName: "safe-project",
      defaultBranch: "main",
      projectType: "custom" as const,
    };
    await initializeProjectRepository(validInput);

    await expect(initializeProjectRepository(validInput)).rejects.toThrow("already exists");
    await expect(
      initializeProjectRepository({ ...validInput, directoryName: "../outside" }),
    ).rejects.toThrow("Directory name must be one visible folder name");
    await expect(
      initializeProjectRepository({ ...validInput, directoryName: "other", defaultBranch: "-bad" }),
    ).rejects.toThrow("Invalid Git branch name");
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-create-project-")));
  temporaryDirectories.push(root);
  process.env.RELAY_PROJECTS_DIR = root;
  return root;
}
