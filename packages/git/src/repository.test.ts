import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createTaskWorktree, GitRepository, taskBranchName } from "./repository";

const exec = promisify(execFile);

describe("Git worktree manager", () => {
  it("creates an isolated branch and atomic commit", async () => {
    const repositoryPath = await mkdtemp(join(tmpdir(), "relay-git-"));
    await exec("git", ["init", "-b", "main", repositoryPath]);
    await exec("git", ["-C", repositoryPath, "config", "user.email", "relay@example.test"]);
    await exec("git", ["-C", repositoryPath, "config", "user.name", "Relay Test"]);
    await writeFile(join(repositoryPath, "README.md"), "base\n");
    await exec("git", ["-C", repositoryPath, "add", "."]);
    await exec("git", ["-C", repositoryPath, "commit", "-m", "base"]);

    const worktreePath = `${repositoryPath}-worktree`;
    const branch = taskBranchName("12345678-0000", "Add useful evidence");
    const worktree = await createTaskWorktree({
      repositoryPath,
      worktreePath,
      branch,
      baseBranch: "main",
    });
    await writeFile(join(worktreePath, "evidence.txt"), "verified\n");
    const sha = await worktree.createCommit("feat: add useful evidence");

    expect(sha).toHaveLength(40);
    expect(await worktree.status()).toEqual([]);
    expect(
      (await new GitRepository(repositoryPath).git(["branch", "--list", branch])).trim(),
    ).toContain(branch);
  });
});
