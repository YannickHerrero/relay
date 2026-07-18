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
  deployments,
  messages,
  planVersions,
  projects,
  requirementDrafts,
  reviewComments,
  reviewRequests,
  specificationVersions,
  taskCommits,
  tasks,
} from "@relay/db";
import { assertTransition } from "@relay/domain";
import { desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { WorkflowEngine } from "./engine";

const exec = promisify(execFile);

class LifecycleAgent implements AgentAdapter {
  private readonly sessions = new Map<string, { session: AgentSession; cwd: string }>();
  private implementationTurn = 0;

  async createSession(input: CreateSessionInput): Promise<AgentSession> {
    const session = { id: randomUUID(), role: input.role, provider: "lifecycle-fixture" };
    this.sessions.set(session.id, { session, cwd: input.cwd });
    return session;
  }

  async *runTurn(input: RunTurnInput): AsyncIterable<AgentEvent> {
    const entry = this.sessions.get(input.sessionId);
    if (!entry) throw new Error("Missing lifecycle session");
    let payload: unknown;
    if (entry.session.role === "product-refiner") {
      payload = {
        message: "The requirement is ready for approval.",
        waitingForUser: false,
        specification: lifecycleRequirement,
      };
    } else if (entry.session.role === "technical-planner") {
      payload = { message: "Two atomic commits.", plan: lifecyclePlan };
    } else if (entry.session.role === "implementer") {
      this.implementationTurn += 1;
      await mkdir(join(entry.cwd, "src"), { recursive: true });
      await writeFile(
        join(entry.cwd, "src", `change-${this.implementationTurn}.txt`),
        `evidence ${this.implementationTurn}\n`,
      );
      payload = {
        summary: `Completed implementation turn ${this.implementationTurn}`,
        deviations: [],
        manualChecks: [],
      };
    } else {
      payload = { likelyCause: "Fixture failure", evidence: [], suggestedActions: [] };
    }
    const output = `<relay-output>${JSON.stringify(payload)}</relay-output>`;
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

const lifecycleRequirement = {
  title: "Lifecycle fixture",
  problem: "The complete flow needs evidence",
  objective: "Reach Done without bypassing a gate",
  expectedBehavior: ["Create two atomic commits"],
  userFlows: [],
  acceptanceCriteria: ["Validation passes", "Deployment remains explicit"],
  edgeCases: [],
  constraints: [],
  outOfScope: [],
  unresolvedQuestions: [],
  attachments: [],
};

const lifecyclePlan = {
  understanding: "Create two independent evidence files",
  assumptions: [],
  affectedAreas: ["src"],
  commits: [1, 2].map((order) => ({
    id: `planned-${order}`,
    order,
    title: `feat: add lifecycle evidence ${order}`,
    goal: `Create evidence ${order}`,
    files: [`src/change-${order}.txt`],
    implementationSteps: ["Create the evidence file"],
    tests: [`test -f src/change-${order}.txt`],
    dependencies: order === 2 ? ["planned-1"] : [],
  })),
  finalValidation: ["Check both files"],
  deploymentImpact: [],
  migrations: [],
  newDependencies: [],
  configurationChanges: [],
  risks: [],
  outOfScope: [],
};

describe("complete Relay lifecycle", () => {
  it("refines, plans, commits, reviews, deploys, and archives one card", async () => {
    const repositoryPath = await mkdtemp(join(tmpdir(), "relay-lifecycle-repo-"));
    const dataDir = await mkdtemp(join(tmpdir(), "relay-lifecycle-data-"));
    await exec("git", ["init", "-b", "main", repositoryPath]);
    await exec("git", ["-C", repositoryPath, "config", "user.email", "relay@example.test"]);
    await exec("git", ["-C", repositoryPath, "config", "user.name", "Relay Lifecycle"]);
    await mkdir(join(repositoryPath, ".relay"));
    await writeFile(
      join(repositoryPath, ".relay/project.config.ts"),
      `export default { commands: { finalValidation: ["test -f src/change-1.txt && test -f src/change-2.txt"] }, deploymentRecipes: [{ id: "local", label: "Local proof", kind: "command", commands: ["test -f src/change-1.txt"], environment: "test" }] }`,
    );
    await writeFile(join(repositoryPath, "README.md"), "Relay lifecycle fixture\n");
    await exec("git", ["-C", repositoryPath, "add", "."]);
    await exec("git", ["-C", repositoryPath, "commit", "-m", "chore: initialize lifecycle"]);

    const database = createDatabase(":memory:");
    const agent = new LifecycleAgent();
    const engine = new WorkflowEngine({ database, agent, dataDir });
    const now = new Date().toISOString();
    const projectId = randomUUID();
    const taskId = randomUUID();
    database.db
      .insert(projects)
      .values({
        id: projectId,
        name: "Lifecycle",
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
        title: "Complete lifecycle",
        initialRequest: "Prove the flow",
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
        content: "Prove the complete Relay flow",
        attachments: [],
        createdAt: now,
      })
      .run();

    await engine.handle({
      id: randomUUID(),
      taskId,
      type: "refinement.start",
      payload: {},
      attempts: 1,
      maxAttempts: 1,
    });
    const draft = database.db
      .select()
      .from(requirementDrafts)
      .where(eq(requirementDrafts.taskId, taskId))
      .get();
    expect(draft).toBeTruthy();

    assertTransition("refinement", "planning", "user");
    const specificationId = randomUUID();
    database.db
      .insert(specificationVersions)
      .values({
        id: specificationId,
        taskId,
        version: 1,
        content: draft!.content,
        approvedAt: now,
        createdAt: now,
      })
      .run();
    database.db
      .update(tasks)
      .set({
        stage: "planning",
        runtimeStatus: "agent_running",
        activeSpecificationVersionId: specificationId,
      })
      .where(eq(tasks.id, taskId))
      .run();
    await engine.handle({
      id: randomUUID(),
      taskId,
      type: "planning.start",
      payload: {},
      attempts: 1,
      maxAttempts: 1,
    });

    const plan = database.db
      .select()
      .from(planVersions)
      .where(eq(planVersions.taskId, taskId))
      .orderBy(desc(planVersions.version))
      .get()!;
    assertTransition("planning", "implementation", "user");
    database.db
      .update(planVersions)
      .set({ approvedAt: now })
      .where(eq(planVersions.id, plan.id))
      .run();
    database.db
      .update(tasks)
      .set({
        stage: "implementation",
        runtimeStatus: "agent_running",
        activePlanVersionId: plan.id,
      })
      .where(eq(tasks.id, taskId))
      .run();
    await engine.handle({
      id: randomUUID(),
      taskId,
      type: "implementation.start",
      payload: {},
      attempts: 1,
      maxAttempts: 1,
    });
    expect(database.db.select().from(tasks).where(eq(tasks.id, taskId)).get()).toMatchObject({
      stage: "implementation",
      runtimeStatus: "waiting_for_user",
    });
    expect(
      database.db.select().from(taskCommits).where(eq(taskCommits.taskId, taskId)).all(),
    ).toHaveLength(2);

    assertTransition("implementation", "review", "user");
    database.db
      .update(tasks)
      .set({ stage: "review", runtimeStatus: "waiting_for_user" })
      .where(eq(tasks.id, taskId))
      .run();
    assertTransition("review", "implementation", "user");
    const reviewId = randomUUID();
    database.db
      .insert(reviewRequests)
      .values({ id: reviewId, taskId, version: 1, status: "open", createdAt: now })
      .run();
    database.db
      .insert(reviewComments)
      .values({
        id: randomUUID(),
        reviewRequestId: reviewId,
        targetType: "global",
        content: "Add one review evidence file",
        createdAt: now,
      })
      .run();
    database.db
      .update(tasks)
      .set({ stage: "implementation", runtimeStatus: "agent_running" })
      .where(eq(tasks.id, taskId))
      .run();
    await engine.handle({
      id: randomUUID(),
      taskId,
      type: "implementation.review_changes",
      payload: { reviewId },
      attempts: 1,
      maxAttempts: 1,
    });
    expect(database.db.select().from(tasks).where(eq(tasks.id, taskId)).get()).toMatchObject({
      stage: "implementation",
      runtimeStatus: "waiting_for_user",
    });

    assertTransition("implementation", "review", "user");
    database.db
      .update(tasks)
      .set({ stage: "review", runtimeStatus: "waiting_for_user" })
      .where(eq(tasks.id, taskId))
      .run();
    assertTransition("review", "ready_to_deploy", "user");
    database.db
      .update(tasks)
      .set({ stage: "ready_to_deploy", runtimeStatus: "idle" })
      .where(eq(tasks.id, taskId))
      .run();
    const latestCommit = database.db
      .select()
      .from(taskCommits)
      .where(eq(taskCommits.taskId, taskId))
      .orderBy(desc(taskCommits.order))
      .get()!;
    const deploymentId = randomUUID();
    const recipe = {
      id: "local",
      label: "Local proof",
      kind: "command" as const,
      commands: ["test -f src/change-1.txt"],
      environment: "test",
      requiresConfirmation: true,
    };
    assertTransition("ready_to_deploy", "deploying", "user");
    database.db
      .insert(deployments)
      .values({
        id: deploymentId,
        taskId,
        recipeId: recipe.id,
        recipeSnapshot: recipe,
        status: "pending",
        commitSha: latestCommit.sha,
        createdAt: now,
      })
      .run();
    database.db
      .update(tasks)
      .set({ stage: "deploying", runtimeStatus: "agent_running" })
      .where(eq(tasks.id, taskId))
      .run();
    await engine.handle({
      id: randomUUID(),
      taskId,
      type: "deployment.run",
      payload: { deploymentId },
      attempts: 1,
      maxAttempts: 1,
    });

    expect(database.db.select().from(tasks).where(eq(tasks.id, taskId)).get()?.stage).toBe("done");
    expect(
      database.db.select().from(deployments).where(eq(deployments.id, deploymentId)).get()?.status,
    ).toBe("succeeded");
    await agent.close();
    database.sqlite.close();
  });
});
