import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createDatabase, messages, projects, tasks } from "@relay/db";
import { describe, expect, it } from "vitest";

import { deleteTask } from "./task-deletion";

describe("task deletion", () => {
  it("deletes an inactive task, dependent history, uploads, and artifacts", async () => {
    const fixture = await taskFixture("failed");
    const uploadDirectory = join(fixture.dataDir, "uploads", fixture.taskId);
    const artifactDirectory = join(fixture.dataDir, "artifacts", fixture.taskId);
    await Promise.all([
      mkdir(uploadDirectory, { recursive: true }),
      mkdir(artifactDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(uploadDirectory, "evidence.txt"), "evidence"),
      writeFile(join(artifactDirectory, "report.txt"), "report"),
    ]);

    await deleteTask(fixture.taskId, {
      relayDatabase: fixture.database,
      dataDir: fixture.dataDir,
    });

    expect(fixture.database.db.select().from(tasks).all()).toHaveLength(0);
    expect(fixture.database.db.select().from(messages).all()).toHaveLength(0);
    await expect(access(uploadDirectory)).rejects.toThrow();
    await expect(access(artifactDirectory)).rejects.toThrow();
    fixture.database.sqlite.close();
    await rm(fixture.dataDir, { recursive: true, force: true });
  });

  it("refuses to delete an active task", async () => {
    const fixture = await taskFixture("agent_running");

    await expect(
      deleteTask(fixture.taskId, {
        relayDatabase: fixture.database,
        dataDir: fixture.dataDir,
      }),
    ).rejects.toThrow("Stop the active task");

    expect(fixture.database.db.select().from(tasks).all()).toHaveLength(1);
    fixture.database.sqlite.close();
    await rm(fixture.dataDir, { recursive: true, force: true });
  });
});

async function taskFixture(runtimeStatus: "failed" | "agent_running") {
  const database = createDatabase(":memory:");
  const dataDir = await mkdtemp(join(tmpdir(), "relay-task-delete-"));
  const now = new Date().toISOString();
  const projectId = randomUUID();
  const taskId = randomUUID();
  database.db
    .insert(projects)
    .values({
      id: projectId,
      name: "Fixture",
      repositoryPath: "/tmp/delete-fixture",
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
      title: "Delete me",
      initialRequest: "Remove the task",
      type: "feature",
      priority: "medium",
      stage: "refinement",
      runtimeStatus,
      baseBranch: "main",
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  database.db
    .insert(messages)
    .values({
      id: randomUUID(),
      taskId,
      role: "user",
      content: "Remove the task",
      attachments: [],
      createdAt: now,
    })
    .run();
  return { database, dataDir, taskId };
}
