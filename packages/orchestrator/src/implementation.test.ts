import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  AgentAdapter,
  AgentEvent,
  AgentSession,
  CreateSessionInput,
  RunTurnInput,
} from "@relay/agent";
import {
  createDatabase,
  planVersions,
  projects,
  specificationVersions,
  taskCommits,
  tasks,
} from "@relay/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { WorkflowEngine } from "./engine";

const exec = promisify(execFile);

class EditingAgent implements AgentAdapter {
  private readonly sessions = new Map<string, { session: AgentSession; cwd: string }>();
  private turn = 0;

  async createSession(input: CreateSessionInput): Promise<AgentSession> {
    const session = { id: randomUUID(), role: input.role, provider: "fixture" };
    this.sessions.set(session.id, { session, cwd: input.cwd });
    return session;
  }

  async *runTurn(input: RunTurnInput): AsyncIterable<AgentEvent> {
    const entry = this.sessions.get(input.sessionId);
    if (!entry) throw new Error("Missing fixture session");
    this.turn += 1;
    await mkdir(join(entry.cwd, "src"), { recursive: true });
    await writeFile(join(entry.cwd, "src", `${this.turn}.txt`), `commit ${this.turn}\n`);
    const output = `<relay-output>${JSON.stringify({ summary: `Implemented commit ${this.turn}`, deviations: [], manualChecks: [] })}</relay-output>`;
    yield { type: "turn.started", turnId: randomUUID() };
    yield { type: "turn.completed", output };
  }

  async interrupt(): Promise<void> {}
  async resume(): Promise<void> {}
  async forkSession(): Promise<AgentSession> {
    throw new Error("Not used");
  }
  async close(): Promise<void> {
    this.sessions.clear();
  }
}

describe("implementation workflow", () => {
  it("creates one validated Git commit per approved plan item and reaches review", async () => {
    const repositoryPath = await mkdtemp(join(tmpdir(), "relay-implementation-repo-"));
    const dataDir = await mkdtemp(join(tmpdir(), "relay-implementation-data-"));
    await exec("git", ["init", "-b", "main", repositoryPath]);
    await exec("git", ["-C", repositoryPath, "config", "user.email", "relay@example.test"]);
    await exec("git", ["-C", repositoryPath, "config", "user.name", "Relay Test"]);
    await mkdir(join(repositoryPath, ".relay"));
    await writeFile(
      join(repositoryPath, ".relay/project.config.ts"),
      `export default { commands: { finalValidation: ["test -f src/1.txt && test -f src/2.txt"] } }`,
    );
    await writeFile(join(repositoryPath, "README.md"), "fixture\n");
    await exec("git", ["-C", repositoryPath, "add", "."]);
    await exec("git", ["-C", repositoryPath, "commit", "-m", "chore: initialize fixture"]);

    const database = createDatabase(":memory:");
    const now = new Date().toISOString();
    const projectId = randomUUID();
    const taskId = randomUUID();
    const specificationId = randomUUID();
    const planId = randomUUID();
    const requirement = {
      title: "Two commits",
      problem: "Need evidence",
      objective: "Commit twice",
      expectedBehavior: [],
      userFlows: [],
      acceptanceCriteria: ["Two commits"],
      edgeCases: [],
      constraints: [],
      outOfScope: [],
      unresolvedQuestions: [],
      attachments: [],
    };
    const plan = {
      understanding: "Create two files",
      assumptions: [],
      affectedAreas: ["src"],
      commits: [1, 2].map((order) => ({
        id: `commit-${order}`,
        order,
        title: `feat: add fixture ${order}`,
        goal: `Add file ${order}`,
        files: [`src/${order}.txt`],
        implementationSteps: ["Create file"],
        tests: [`test -f src/${order}.txt`],
        dependencies: order === 2 ? ["commit-1"] : [],
      })),
      finalValidation: ["test files"],
      deploymentImpact: [],
      migrations: [],
      newDependencies: [],
      configurationChanges: [],
      risks: [],
      outOfScope: [],
    };
    database.db
      .insert(projects)
      .values({
        id: projectId,
        name: "Fixture",
        repositoryPath,
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
        title: "Two commits",
        initialRequest: "Create evidence",
        type: "feature",
        priority: "high",
        stage: "implementation",
        runtimeStatus: "agent_running",
        baseBranch: "main",
        activeSpecificationVersionId: specificationId,
        activePlanVersionId: planId,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(specificationVersions)
      .values({
        id: specificationId,
        taskId,
        version: 1,
        content: requirement,
        approvedAt: now,
        createdAt: now,
      })
      .run();
    database.db
      .insert(planVersions)
      .values({ id: planId, taskId, version: 1, content: plan, approvedAt: now, createdAt: now })
      .run();

    const agent = new EditingAgent();
    const engine = new WorkflowEngine({ database, agent, dataDir });
    await engine.handle({
      id: randomUUID(),
      taskId,
      type: "implementation.start",
      payload: {},
      attempts: 1,
      maxAttempts: 3,
    });

    const completed = database.db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    expect(completed).toMatchObject({
      stage: "implementation",
      runtimeStatus: "waiting_for_user",
    });
    expect(
      database.db.select().from(taskCommits).where(eq(taskCommits.taskId, taskId)).all(),
    ).toHaveLength(2);
    expect(completed?.worktreePath).toContain(taskId);
    await agent.close();
    database.sqlite.close();
  });
});
