import { randomUUID } from "node:crypto";

import { FakeAgentAdapter } from "@relay/agent/testing";
import { createDatabase, messages, projects, requirementDrafts, tasks } from "@relay/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { WorkflowEngine } from "./engine";

describe("refinement workflow", () => {
  it("persists the agent conversation and live requirement", async () => {
    const database = createDatabase(":memory:");
    const now = new Date().toISOString();
    const projectId = randomUUID();
    const taskId = randomUUID();
    database.db
      .insert(projects)
      .values({
        id: projectId,
        name: "Fixture",
        repositoryPath: process.cwd(),
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
        title: "Faster definitions",
        initialRequest: "Keep reading position",
        type: "feature",
        priority: "high",
        stage: "refinement",
        runtimeStatus: "agent_running",
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
        content: "Make definitions faster",
        attachments: [],
        createdAt: now,
      })
      .run();
    const requirement = {
      title: "Faster definitions",
      problem: "Definitions feel slow",
      objective: "Reduce perceived latency",
      expectedBehavior: ["Keep reading position"],
      userFlows: [],
      acceptanceCriteria: ["Position is unchanged"],
      edgeCases: [],
      constraints: [],
      outOfScope: [],
      unresolvedQuestions: [
        { id: "q1", question: "Should cached results expire?", blocking: false, status: "open" },
      ],
      attachments: [],
    };
    const agent = new FakeAgentAdapter([
      `<relay-output>${JSON.stringify({ message: "How long should cache entries live?", specification: requirement, waitingForUser: true })}</relay-output>`,
    ]);
    const engine = new WorkflowEngine({ database, agent, dataDir: "/tmp/relay" });
    await engine.handle({
      id: randomUUID(),
      taskId,
      type: "refinement.start",
      payload: {},
      attempts: 1,
      maxAttempts: 3,
    });

    expect(
      database.db.select().from(requirementDrafts).where(eq(requirementDrafts.taskId, taskId)).get()
        ?.content,
    ).toMatchObject({ objective: "Reduce perceived latency" });
    expect(
      database.db.select().from(messages).where(eq(messages.taskId, taskId)).all(),
    ).toHaveLength(2);
    expect(database.db.select().from(tasks).where(eq(tasks.id, taskId)).get()?.runtimeStatus).toBe(
      "waiting_for_user",
    );
    await agent.close();
    database.sqlite.close();
  });
});
