import { randomUUID } from "node:crypto";

import {
  createDatabase,
  orchestrationJobs,
  planVersions,
  projects,
  requirementDrafts,
  taskEvents,
  taskPhaseVisits,
  tasks,
} from "@relay/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { advanceTask } from "./task-transitions";

const requirement = {
  title: "Simpler workflow",
  problem: "The current workflow is complex",
  objective: "Make each phase explicit",
  expectedBehavior: ["Tasks advance sequentially"],
  userFlows: [{ name: "Approve requirement", steps: ["Approve the requirement"] }],
  acceptanceCriteria: ["Planning starts after approval"],
  edgeCases: [],
  constraints: [],
  outOfScope: [],
  unresolvedQuestions: [],
  attachments: [],
};

const plan = {
  understanding: "Implement the workflow safely",
  assumptions: [],
  affectedAreas: ["apps/web"],
  commits: [
    {
      id: "commit-1",
      order: 1,
      title: "feat: simplify workflow",
      goal: "Keep one concern",
      files: ["apps/web/workflow.ts"],
      implementationSteps: ["Implement it"],
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

describe("task phase transitions", () => {
  it("advances refinement and planning through the same validated service", () => {
    const fixture = taskFixture("refinement", "waiting_for_user");
    fixture.database.db
      .insert(requirementDrafts)
      .values({ taskId: fixture.taskId, content: requirement, updatedAt: fixture.now })
      .run();

    expect(advanceTask(fixture.taskId, "planning", fixture.database)).toMatchObject({
      stage: "planning",
      phase: "plan",
      version: 1,
    });
    expect(task(fixture)).toMatchObject({ stage: "planning", runtimeStatus: "agent_running" });
    expect(phases(fixture)).toContain("plan");

    fixture.database.db
      .update(orchestrationJobs)
      .set({ status: "completed", updatedAt: fixture.now })
      .where(eq(orchestrationJobs.taskId, fixture.taskId))
      .run();
    fixture.database.db
      .update(tasks)
      .set({ runtimeStatus: "waiting_for_user" })
      .where(eq(tasks.id, fixture.taskId))
      .run();
    fixture.database.db
      .insert(planVersions)
      .values({
        id: randomUUID(),
        taskId: fixture.taskId,
        version: 1,
        content: plan,
        createdAt: fixture.now,
      })
      .run();

    expect(advanceTask(fixture.taskId, "implementation", fixture.database)).toMatchObject({
      stage: "implementation",
      phase: "build",
      version: 1,
    });
    expect(task(fixture)).toMatchObject({
      stage: "implementation",
      runtimeStatus: "agent_running",
    });
    expect(phases(fixture)).toContain("build");
    fixture.database.sqlite.close();
  });

  it("moves validated implementation to review only after it is ready", () => {
    const fixture = taskFixture("implementation", "waiting_for_user");
    fixture.database.db
      .insert(taskEvents)
      .values({
        taskId: fixture.taskId,
        type: "implementation.ready_for_review",
        actor: "agent",
        payload: {},
        createdAt: fixture.now,
      })
      .run();

    expect(advanceTask(fixture.taskId, "review", fixture.database)).toMatchObject({
      stage: "review",
      phase: "review",
    });
    expect(task(fixture)).toMatchObject({ stage: "review", runtimeStatus: "waiting_for_user" });
    expect(phases(fixture)).toContain("review");
    fixture.database.sqlite.close();
  });

  it("rejects skipped phases and unfinished implementation", () => {
    const refinement = taskFixture("refinement", "waiting_for_user");
    expect(() => advanceTask(refinement.taskId, "implementation", refinement.database)).toThrow(
      "cannot move",
    );
    refinement.database.sqlite.close();

    const implementation = taskFixture("implementation", "idle");
    expect(() => advanceTask(implementation.taskId, "review", implementation.database)).toThrow(
      "not ready",
    );
    implementation.database.sqlite.close();
  });
});

function taskFixture(stage: string, runtimeStatus: string) {
  const database = createDatabase(":memory:");
  const now = new Date().toISOString();
  const projectId = randomUUID();
  const taskId = randomUUID();
  database.db
    .insert(projects)
    .values({
      id: projectId,
      name: "Fixture",
      repositoryPath: "/tmp/transition-fixture",
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
      title: "Move safely",
      initialRequest: "Keep transitions sequential",
      type: "feature",
      priority: "medium",
      stage,
      runtimeStatus,
      baseBranch: "main",
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  database.db
    .insert(taskPhaseVisits)
    .values({
      taskId,
      phase: stage === "refinement" ? "refine" : stage === "planning" ? "plan" : "build",
      firstStartedAt: now,
      lastStartedAt: now,
    })
    .run();
  return { database, now, taskId };
}

function task(fixture: ReturnType<typeof taskFixture>) {
  return fixture.database.db.select().from(tasks).where(eq(tasks.id, fixture.taskId)).get();
}

function phases(fixture: ReturnType<typeof taskFixture>) {
  return fixture.database.db
    .select({ phase: taskPhaseVisits.phase })
    .from(taskPhaseVisits)
    .where(eq(taskPhaseVisits.taskId, fixture.taskId))
    .all()
    .map((row) => row.phase);
}
