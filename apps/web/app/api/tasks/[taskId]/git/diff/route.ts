import { taskCommits, tasks } from "@relay/db";
import { GitRepository } from "@relay/git";
import { and, eq } from "drizzle-orm";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const { taskId } = await context.params;
  const { db } = database();
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task?.worktreePath) return new Response("Worktree not available", { status: 404 });
  const url = new URL(request.url);
  const sha = url.searchParams.get("sha");
  const current = url.searchParams.get("mode") === "current";
  const repository = new GitRepository(task.worktreePath);
  try {
    let diff: string;
    if (current) {
      diff = await repository.diff();
    } else if (sha) {
      const commit = db
        .select()
        .from(taskCommits)
        .where(and(eq(taskCommits.taskId, taskId), eq(taskCommits.sha, sha)))
        .get();
      if (!commit) return new Response("Commit not found", { status: 404 });
      diff = await repository.git(["show", "--format=fuller", "--stat", "--patch", sha]);
    } else {
      diff = await repository.diff(`${task.baseBranch}...HEAD`);
    }
    return new Response(diff, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `inline; filename="${current ? "current" : sha ? sha.slice(0, 10) : "total"}.diff"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Unable to read diff", {
      status: 500,
    });
  }
}
