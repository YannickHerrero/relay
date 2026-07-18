import { randomUUID } from "node:crypto";

import { orchestrationJobs, taskEvents, tasks, type RelayDatabase } from "@relay/db";
import { and, desc, eq } from "drizzle-orm";

import { database } from "./database";

const RETRYABLE_JOB_TYPES = new Set([
  "refinement.start",
  "refinement.message",
  "planning.start",
  "planning.revise",
  "implementation.start",
  "implementation.resume",
  "implementation.instruction",
  "implementation.review_changes",
  "tests.rerun",
]);

export function retryFailedTask(taskId: string, relayDatabase: RelayDatabase = database()): string {
  const { db, sqlite } = relayDatabase;
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) throw new Error("Task not found");
  if (task.runtimeStatus !== "failed") throw new Error("Only failed tasks can be retried");
  const failedJob = db
    .select()
    .from(orchestrationJobs)
    .where(and(eq(orchestrationJobs.taskId, taskId), eq(orchestrationJobs.status, "failed")))
    .orderBy(desc(orchestrationJobs.updatedAt))
    .get();
  if (!failedJob) throw new Error("No failed task operation is available to retry");
  if (!RETRYABLE_JOB_TYPES.has(failedJob.type)) {
    throw new Error(
      failedJob.type === "deployment.run"
        ? "Retry this deployment from the Deployment tab"
        : `Task operation '${failedJob.type}' cannot be retried`,
    );
  }

  const now = new Date().toISOString();
  const jobId = randomUUID();
  sqlite.transaction(() => {
    db.update(tasks)
      .set({
        runtimeStatus: "agent_running",
        blockedReason: null,
        updatedAt: now,
        lastActivityAt: now,
      })
      .where(eq(tasks.id, taskId))
      .run();
    db.insert(orchestrationJobs)
      .values({
        id: jobId,
        taskId,
        type: failedJob.type,
        payload: failedJob.payload,
        status: "queued",
        maxAttempts: failedJob.maxAttempts,
        idempotencyKey: `${taskId}:${failedJob.type}:retry:${jobId}`,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(taskEvents)
      .values({
        taskId,
        type: "task.retry_requested",
        actor: "user",
        payload: { jobType: failedJob.type, failedJobId: failedJob.id, retryJobId: jobId },
        createdAt: now,
      })
      .run();
  })();
  return jobId;
}
