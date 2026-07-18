import { randomUUID } from "node:crypto";

import { FakeAgentAdapter } from "@relay/agent/testing";
import { createDatabase, planVersions, projects, specificationVersions, tasks } from "@relay/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { WorkflowEngine } from "./engine";

describe("planning workflow", () => {
  it("stores an immutable commit-by-commit plan", async () => {
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
        title: "Plan safely",
        initialRequest: "Use atomic commits",
        type: "feature",
        priority: "high",
        stage: "planning",
        runtimeStatus: "agent_running",
        baseBranch: "main",
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(specificationVersions)
      .values({
        id: randomUUID(),
        taskId,
        version: 1,
        content: {
          title: "Plan safely",
          problem: "Changes are too large",
          objective: "Use atomic commits",
          expectedBehavior: [],
          userFlows: [],
          acceptanceCriteria: ["Several commits"],
          edgeCases: [],
          constraints: [],
          outOfScope: [],
          unresolvedQuestions: [],
          attachments: [],
        },
        approvedAt: now,
        createdAt: now,
      })
      .run();
    const plan = {
      understanding: "Split the work",
      assumptions: [],
      affectedAreas: ["src"],
      commits: [
        {
          id: "commit-1",
          order: 1,
          title: "feat: add safe change",
          goal: "One concern",
          files: ["src/change.ts"],
          implementationSteps: ["Add change"],
          tests: ["pnpm test"],
          dependencies: [],
        },
      ],
      finalValidation: ["pnpm test"],
      deploymentImpact: [],
      migrations: [],
      newDependencies: [],
      configurationChanges: [],
      risks: [],
      outOfScope: [],
    };
    const agent = new FakeAgentAdapter([
      `<relay-output>${JSON.stringify({ message: "One atomic commit", plan })}</relay-output>`,
    ]);
    const engine = new WorkflowEngine({ database, agent, dataDir: "/tmp/relay" });
    await engine.handle({
      id: randomUUID(),
      taskId,
      type: "planning.start",
      payload: {},
      attempts: 1,
      maxAttempts: 3,
    });

    expect(
      database.db.select().from(planVersions).where(eq(planVersions.taskId, taskId)).get()?.content,
    ).toMatchObject({ understanding: "Split the work" });
    expect(database.db.select().from(tasks).where(eq(tasks.id, taskId)).get()?.runtimeStatus).toBe(
      "waiting_for_user",
    );
    await agent.close();
    database.sqlite.close();
  });
});
