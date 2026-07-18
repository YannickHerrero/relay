import { execFile } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitStatusEntry = {
  index: string;
  worktree: string;
  path: string;
};

export class GitRepository {
  constructor(readonly root: string) {}

  async head(): Promise<string> {
    return (await this.git(["rev-parse", "HEAD"])).trim();
  }

  async status(): Promise<GitStatusEntry[]> {
    const output = await this.git(["status", "--short", "--untracked-files=all"]);
    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => ({ index: line[0] ?? " ", worktree: line[1] ?? " ", path: line.slice(3) }));
  }

  async assertClean(): Promise<void> {
    const status = await this.status();
    if (status.length)
      throw new Error(`Git worktree is not clean (${status.length} changed paths)`);
  }

  async diffCheck(): Promise<void> {
    await this.git(["diff", "--check"]);
  }

  async diff(ref?: string): Promise<string> {
    return this.git(ref ? ["diff", ref] : ["diff"]);
  }

  async diffStat(ref?: string): Promise<string> {
    return this.git(ref ? ["diff", "--stat", ref] : ["diff", "--stat"]);
  }

  async createCommit(message: string): Promise<string> {
    await this.diffCheck();
    await this.git(["add", "--all"]);
    const staged = await this.git(["diff", "--cached", "--name-only"]);
    if (!staged.trim()) throw new Error("The planned commit produced no changes");
    await this.git(["commit", "-m", message]);
    return this.head();
  }

  async commits(baseRef: string): Promise<Array<{ sha: string; message: string }>> {
    const output = await this.git(["log", "--format=%H%x00%s", `${baseRef}..HEAD`]);
    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha = "", message = ""] = line.split("\0");
        return { sha, message };
      });
  }

  async git(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", ["-C", this.root, ...args], {
        maxBuffer: 20 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr?.trim();
      throw new Error(stderr || `Git command failed: git ${args.join(" ")}`, { cause: error });
    }
  }
}

export async function createTaskWorktree(input: {
  repositoryPath: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
}): Promise<GitRepository> {
  const sourceRoot = await realpath(input.repositoryPath);
  const source = new GitRepository(sourceRoot);
  await source.assertClean();
  await source.git(["rev-parse", "--verify", input.baseBranch]);
  await mkdir(dirname(input.worktreePath), { recursive: true });
  await source.git(["worktree", "add", "-b", input.branch, input.worktreePath, input.baseBranch]);
  const worktree = new GitRepository(await realpath(input.worktreePath));
  await worktree.assertClean();
  return worktree;
}

export function taskBranchName(taskId: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
  return `relay/task-${taskId.slice(0, 8)}-${slug || "work"}`;
}
