import { randomUUID } from "node:crypto";

import { createDatabase, orchestrationJobs, projects, taskEvents, tasks } from "@relay/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { retryFailedTask } from "./task-recovery";

describe("failed task recovery", () => {
  it("queues the same safe operation and restores the running status", () => {
    const fixture = failedTaskFixture("refinement.start");

    const retryJobId = retryFailedTask(fixture.taskId, fixture.database);

    expect(
      fixture.database.db.select().from(tasks).where(eq(tasks.id, fixture.taskId)).get(),
    ).toMatchObject({ runtimeStatus: "agent_running", blockedReason: null });
    expect(
      fixture.database.db
        .select()
        .from(orchestrationJobs)
        .where(eq(orchestrationJobs.id, retryJobId))
        .get(),
    ).toMatchObject({ type: "refinement.start", status: "queued", attempts: 0 });
    expect(fixture.database.db.select().from(taskEvents).all()).toHaveLength(1);
    fixture.database.sqlite.close();
  });

  it("keeps deployment retries behind deployment confirmation", () => {
    const fixture = failedTaskFixture("deployment.run");

    expect(() => retryFailedTask(fixture.taskId, fixture.database)).toThrow("Deployment tab");

    fixture.database.sqlite.close();
  });
});

function failedTaskFixture(jobType: string) {
  const database = createDatabase(":memory:");
  const now = new Date().toISOString();
  const projectId = randomUUID();
  const taskId = randomUUID();
  database.db
    .insert(projects)
    .values({
      id: projectId,
      name: "Fixture",
      repositoryPath: "/tmp/retry-fixture",
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
      title: "Retry me",
      initialRequest: "Recover the task",
      type: "feature",
      priority: "medium",
      stage: "refinement",
      runtimeStatus: "failed",
      blockedReason: "Agent failed",
      baseBranch: "main",
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  database.db
    .insert(orchestrationJobs)
    .values({
      id: randomUUID(),
      taskId,
      type: jobType,
      payload: { source: "test" },
      status: "failed",
      attempts: 1,
      maxAttempts: 3,
      idempotencyKey: `${taskId}:${jobType}:failed`,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { database, taskId };
}
