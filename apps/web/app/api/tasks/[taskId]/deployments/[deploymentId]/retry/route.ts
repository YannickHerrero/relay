import { randomUUID } from "node:crypto";

import { deployments, orchestrationJobs, taskEvents, tasks } from "@relay/db";
import { GitRepository } from "@relay/git";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { assertMutationOrigin } from "@/server/security";

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string; deploymentId: string }> },
) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const { taskId, deploymentId } = await context.params;
    const { db, sqlite } = database();
    const task = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.stage, "deploying")))
      .get();
    const deployment = db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.id, deploymentId),
          eq(deployments.taskId, taskId),
          eq(deployments.status, "failed"),
        ),
      )
      .get();
    if (!task?.worktreePath || !deployment)
      throw new Error("Failed deployment is not available to retry");
    const worktree = new GitRepository(task.worktreePath);
    await worktree.assertClean();
    if ((await worktree.head()) !== deployment.commitSha)
      throw new Error("Worktree SHA changed; return to implementation instead");
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      db.update(deployments)
        .set({ status: "pending", diagnosis: null, startedAt: null, completedAt: null })
        .where(eq(deployments.id, deploymentId))
        .run();
      db.update(tasks)
        .set({
          runtimeStatus: "agent_running",
          blockedReason: null,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
      db.insert(taskEvents)
        .values({
          taskId,
          type: "deployment.retry_requested",
          actor: "user",
          payload: { deploymentId },
          createdAt: now,
        })
        .run();
      db.insert(orchestrationJobs)
        .values({
          id: randomUUID(),
          taskId,
          type: "deployment.run",
          payload: { deploymentId },
          status: "queued",
          idempotencyKey: `${taskId}:deployment-retry:${deploymentId}:${now}`,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    })();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to retry deployment" },
      { status: 400 },
    );
  }
}
