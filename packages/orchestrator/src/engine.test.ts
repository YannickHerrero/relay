import { randomUUID } from "node:crypto";

import type { AgentAdapter, AgentSession, CreateSessionInput, RunTurnInput } from "@relay/agent";
import { FakeAgentAdapter } from "@relay/agent/testing";
import { agentRuns, createDatabase, messages, projects, requirementDrafts, tasks } from "@relay/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { NonRetryableJobError, WorkflowEngine } from "./engine";

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

  it("preserves authentication failures as permanent agent errors", async () => {
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
        title: "Authenticate Codex",
        initialRequest: "Run refinement",
        type: "feature",
        priority: "medium",
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
        content: "Run refinement",
        attachments: [],
        createdAt: now,
      })
      .run();
    const engine = new WorkflowEngine({
      database,
      agent: new AuthenticationFailureAdapter(),
      dataDir: "/tmp/relay",
    });

    await expect(
      engine.handle({
        id: randomUUID(),
        taskId,
        type: "refinement.start",
        payload: {},
        attempts: 1,
        maxAttempts: 3,
      }),
    ).rejects.toThrow(NonRetryableJobError);
    expect(database.db.select().from(agentRuns).get()?.status).toBe("failed");
    database.sqlite.close();
  });
});

class AuthenticationFailureAdapter implements AgentAdapter {
  async createSession(input: CreateSessionInput): Promise<AgentSession> {
    return { id: randomUUID(), role: input.role, provider: "codex" };
  }

  async *runTurn(_input: RunTurnInput) {
    yield { type: "turn.started" as const, turnId: randomUUID() };
    yield {
      type: "error" as const,
      message: "unexpected status 401 Unauthorized: Missing bearer authentication",
    };
  }

  async interrupt(_sessionId: string): Promise<void> {}
  async resume(_sessionId: string): Promise<void> {}
  async forkSession(_sessionId: string): Promise<AgentSession> {
    throw new Error("Not implemented");
  }
  async close(): Promise<void> {}
}
