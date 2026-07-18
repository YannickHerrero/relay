import { randomUUID } from "node:crypto";

import { createDatabase, projects, tasks } from "@relay/db";
import { describe, expect, it } from "vitest";

import { DurableJobQueue } from "./queue";

describe("durable orchestration queue", () => {
  it("claims idempotent work and holds one task lock", () => {
    const database = createDatabase(":memory:");
    const now = new Date().toISOString();
    const projectId = randomUUID();
    const taskId = randomUUID();
    database.db
      .insert(projects)
      .values({
        id: projectId,
        name: "Fixture",
        repositoryPath: "/tmp/queue",
        defaultBranch: "main",
        projectType: "web",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(tasks)
      .values({
        id: taskId,
        projectId,
        title: "Queue",
        initialRequest: "Recover it",
        type: "feature",
        priority: "medium",
        stage: "refinement",
        runtimeStatus: "idle",
        baseBranch: "main",
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const first = new DurableJobQueue(database, "worker-1");
    const second = new DurableJobQueue(database, "worker-2");
    first.enqueue({ type: "refinement.start", taskId, idempotencyKey: "refine-once" });
    first.enqueue({ type: "refinement.start", taskId, idempotencyKey: "refine-once" });

    const job = first.claim();
    expect(job?.type).toBe("refinement.start");
    expect(second.claim()).toBeNull();
    expect(first.acquireTaskLock(taskId)).toBe(true);
    expect(second.acquireTaskLock(taskId)).toBe(false);
    first.complete(job!.id);
    first.releaseTaskLock(taskId);
    expect(second.acquireTaskLock(taskId)).toBe(true);
    database.sqlite.close();
  });
});
