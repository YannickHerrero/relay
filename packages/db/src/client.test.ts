import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDatabase } from "./client";
import { loginRateLimits, projects, taskEvents, tasks } from "./schema";

describe("Relay database", () => {
  it("migrates and persists a task with append-only events", () => {
    const { db, sqlite } = createDatabase(":memory:");
    const now = new Date().toISOString();
    const projectId = randomUUID();
    const taskId = randomUUID();

    db.insert(projects)
      .values({
        id: projectId,
        name: "Relay fixture",
        repositoryPath: "/tmp/relay-fixture",
        defaultBranch: "main",
        projectType: "web",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(tasks)
      .values({
        id: taskId,
        projectId,
        title: "Persist history",
        initialRequest: "Keep the complete timeline",
        type: "feature",
        priority: "high",
        stage: "refinement",
        runtimeStatus: "idle",
        baseBranch: "main",
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(taskEvents)
      .values({ taskId, type: "task.created", actor: "user", payload: {}, createdAt: now })
      .run();

    expect(db.select().from(tasks).where(eq(tasks.id, taskId)).get()?.title).toBe(
      "Persist history",
    );
    expect(db.select().from(taskEvents).where(eq(taskEvents.taskId, taskId)).all()).toHaveLength(1);

    db.insert(loginRateLimits)
      .values({
        key: "owner-login",
        failedAttempts: 1,
        firstFailedAt: now,
        updatedAt: now,
      })
      .run();
    expect(db.select().from(loginRateLimits).get()?.failedAttempts).toBe(1);
    expect(sqlite.prepare("SELECT name FROM relay_migrations WHERE id = 4").get()).toEqual({
      name: "login-rate-limits",
    });
    expect(sqlite.prepare("SELECT name FROM relay_migrations WHERE id = 5").get()).toEqual({
      name: "task-creation-keys",
    });
    sqlite.close();
  });
});
