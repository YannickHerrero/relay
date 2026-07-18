import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  availableProjectDirectory,
  existingProjectDirectory,
  scanProjectDirectories,
} from "./project-directory";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  delete process.env.RELAY_PROJECTS_DIR;
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("project directory discovery", () => {
  it("discovers immediate visible folders and inspects Git and project metadata", async () => {
    const root = await temporaryRoot();
    const webRepository = join(root, "relay-web");
    const plainFolder = join(root, "notes");
    await Promise.all([
      mkdir(webRepository),
      mkdir(plainFolder),
      mkdir(join(root, ".hidden")),
      mkdir(join(root, "parent", "nested"), { recursive: true }),
    ]);
    await execFileAsync("git", ["init", "-b", "trunk", webRepository]);
    await writeFile(join(webRepository, "package.json"), '{"dependencies":{"next":"latest"}}');
    await symlink(webRepository, join(root, "linked-repository"));

    const result = await scanProjectDirectories(new Map([[webRepository, "registered-id"]]));

    expect(result.root).toBe(root);
    expect(result.projects.map((project) => project.directoryName)).toEqual([
      "notes",
      "parent",
      "relay-web",
    ]);
    expect(result.projects.find((project) => project.directoryName === "relay-web")).toMatchObject({
      isGitRepository: true,
      defaultBranch: "trunk",
      projectType: "web",
      registeredProjectId: "registered-id",
    });
    expect(result.projects.find((project) => project.directoryName === "notes")).toMatchObject({
      isGitRepository: false,
      defaultBranch: null,
      projectType: "custom",
    });
  });

  it("resolves only direct children and rejects existing creation targets", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "safe-project");
    await mkdir(repository);

    await expect(existingProjectDirectory("safe-project")).resolves.toBe(repository);
    await expect(existingProjectDirectory("../outside")).rejects.toThrow(
      "Directory name must be one visible folder name",
    );
    await expect(availableProjectDirectory("safe-project")).rejects.toThrow("already exists");
    await expect(availableProjectDirectory("new-project")).resolves.toBe(join(root, "new-project"));
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-projects-")));
  temporaryDirectories.push(root);
  process.env.RELAY_PROJECTS_DIR = root;
  return root;
}
