import { randomUUID } from "node:crypto";

import type { RelayDatabase } from "@relay/db";
import { orchestrationJobs } from "@relay/db";
import { eq } from "drizzle-orm";

export type OrchestrationJob<T = Record<string, unknown>> = {
  id: string;
  taskId: string | null;
  type: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
};

export class DurableJobQueue {
  constructor(
    private readonly database: RelayDatabase,
    readonly owner: string,
    private readonly leaseMs = 30_000,
  ) {}

  enqueue(input: {
    type: string;
    taskId?: string;
    payload?: Record<string, unknown>;
    idempotencyKey: string;
    availableAt?: Date;
    maxAttempts?: number;
  }): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.db
      .insert(orchestrationJobs)
      .values({
        id,
        taskId: input.taskId,
        type: input.type,
        payload: input.payload ?? {},
        status: "queued",
        maxAttempts: input.maxAttempts ?? 3,
        idempotencyKey: input.idempotencyKey,
        availableAt: (input.availableAt ?? new Date()).toISOString(),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: orchestrationJobs.idempotencyKey })
      .run();
    return id;
  }

  claim(): OrchestrationJob | null {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + this.leaseMs).toISOString();
    const row = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          "UPDATE orchestration_jobs SET status = 'queued', lease_owner = NULL, lease_until = NULL, updated_at = ? WHERE status = 'running' AND lease_until < ?",
        )
        .run(now.toISOString(), now.toISOString());
      const candidate = this.database.sqlite
        .prepare(
          "SELECT id FROM orchestration_jobs WHERE status = 'queued' AND available_at <= ? AND attempts < max_attempts ORDER BY available_at, created_at LIMIT 1",
        )
        .get(now.toISOString()) as { id: string } | undefined;
      if (!candidate) return undefined;
      this.database.sqlite
        .prepare(
          "UPDATE orchestration_jobs SET status = 'running', attempts = attempts + 1, lease_owner = ?, lease_until = ?, updated_at = ? WHERE id = ? AND status = 'queued'",
        )
        .run(this.owner, leaseUntil, now.toISOString(), candidate.id);
      return this.database.db
        .select()
        .from(orchestrationJobs)
        .where(eq(orchestrationJobs.id, candidate.id))
        .get();
    })();
    if (!row) return null;
    return {
      id: row.id,
      taskId: row.taskId,
      type: row.type,
      payload: row.payload as Record<string, unknown>,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
    };
  }

  heartbeat(jobId: string): void {
    const now = new Date();
    this.database.sqlite
      .prepare(
        "UPDATE orchestration_jobs SET lease_until = ?, updated_at = ? WHERE id = ? AND status = 'running' AND lease_owner = ?",
      )
      .run(
        new Date(now.getTime() + this.leaseMs).toISOString(),
        now.toISOString(),
        jobId,
        this.owner,
      );
  }

  complete(jobId: string): void {
    this.database.sqlite
      .prepare(
        "UPDATE orchestration_jobs SET status = 'completed', lease_owner = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND lease_owner = ?",
      )
      .run(new Date().toISOString(), jobId, this.owner);
  }

  fail(job: OrchestrationJob, error: unknown): void {
    const exhausted = job.attempts >= job.maxAttempts;
    const availableAt = new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** job.attempts));
    this.database.sqlite
      .prepare(
        "UPDATE orchestration_jobs SET status = ?, error = ?, available_at = ?, lease_owner = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND lease_owner = ?",
      )
      .run(
        exhausted ? "failed" : "queued",
        error instanceof Error ? (error.stack ?? error.message) : String(error),
        availableAt.toISOString(),
        new Date().toISOString(),
        job.id,
        this.owner,
      );
  }

  acquireTaskLock(taskId: string): boolean {
    const now = new Date();
    const result = this.database.sqlite
      .prepare(
        `INSERT INTO task_locks (task_id, owner, lease_until) VALUES (?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET owner = excluded.owner, lease_until = excluded.lease_until
        WHERE task_locks.lease_until < ? OR task_locks.owner = excluded.owner`,
      )
      .run(
        taskId,
        this.owner,
        new Date(now.getTime() + this.leaseMs).toISOString(),
        now.toISOString(),
      );
    return result.changes === 1;
  }

  releaseTaskLock(taskId: string): void {
    this.database.sqlite
      .prepare("DELETE FROM task_locks WHERE task_id = ? AND owner = ?")
      .run(taskId, this.owner);
  }
}
