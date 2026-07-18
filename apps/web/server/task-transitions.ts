import { randomUUID } from "node:crypto";

import {
  orchestrationJobs,
  planVersions,
  requirementDrafts,
  specificationVersions,
  taskEvents,
  taskPhaseVisits,
  tasks,
  type RelayDatabase,
} from "@relay/db";
import {
  assertTransition,
  implementationPlanSchema,
  refinedRequirementSchema,
} from "@relay/domain";
import { and, desc, eq, inArray } from "drizzle-orm";

import { database } from "./database";

export type AdvanceDestination = "planning" | "implementation" | "review" | "ready_to_deploy";

export type AdvanceResult = {
  stage: AdvanceDestination;
  phase: "plan" | "build" | "review" | "deploy";
  version?: number;
};

export function advanceTask(
  taskId: string,
  destination: AdvanceDestination,
  relayDatabase: RelayDatabase = database(),
): AdvanceResult {
  const { db, sqlite } = relayDatabase;
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) throw new Error("Task not found");
  if (task.runtimeStatus === "agent_running")
    throw new Error("Wait for the active agent to finish");
  const activeJob = db
    .select({ id: orchestrationJobs.id })
    .from(orchestrationJobs)
    .where(
      and(
        eq(orchestrationJobs.taskId, taskId),
        inArray(orchestrationJobs.status, ["queued", "running"]),
      ),
    )
    .get();
  if (activeJob) throw new Error("Wait for the active task operation to finish");

  if (task.stage === "refinement" && destination === "planning") {
    assertTransition("refinement", "planning", "user");
    const draft = db
      .select()
      .from(requirementDrafts)
      .where(eq(requirementDrafts.taskId, taskId))
      .get();
    const content = refinedRequirementSchema.parse(draft?.content);
    const blocking = content.unresolvedQuestions.filter(
      (question) => question.blocking && question.status === "open",
    );
    if (blocking.length) {
      throw new Error(
        `Resolve ${blocking.length} blocking question${blocking.length === 1 ? "" : "s"} first`,
      );
    }
    const previous = db
      .select({ version: specificationVersions.version })
      .from(specificationVersions)
      .where(eq(specificationVersions.taskId, taskId))
      .orderBy(desc(specificationVersions.version))
      .get();
    const now = new Date().toISOString();
    const specificationId = randomUUID();
    const version = (previous?.version ?? 0) + 1;
    sqlite.transaction(() => {
      db.insert(specificationVersions)
        .values({
          id: specificationId,
          taskId,
          version,
          content,
          approvedAt: now,
          createdAt: now,
        })
        .run();
      db.update(tasks)
        .set({
          stage: "planning",
          runtimeStatus: "agent_running",
          activeSpecificationVersionId: specificationId,
          version: task.version + 1,
          blockedReason: null,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
      visitPhase(relayDatabase, taskId, "plan", now);
      db.insert(taskEvents)
        .values({
          taskId,
          type: "requirement.approved",
          actor: "user",
          payload: { specificationVersion: version },
          createdAt: now,
        })
        .run();
      db.insert(orchestrationJobs)
        .values({
          id: randomUUID(),
          taskId,
          type: "planning.start",
          payload: { specificationVersionId: specificationId },
          status: "queued",
          idempotencyKey: `${taskId}:planning:${version}`,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    })();
    return { stage: destination, phase: "plan", version };
  }

  if (task.stage === "planning" && destination === "implementation") {
    assertTransition("planning", "implementation", "user");
    const plan = db
      .select()
      .from(planVersions)
      .where(eq(planVersions.taskId, taskId))
      .orderBy(desc(planVersions.version))
      .get();
    if (!plan) throw new Error("No plan is available to approve");
    implementationPlanSchema.parse(plan.content);
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      db.update(planVersions).set({ approvedAt: now }).where(eq(planVersions.id, plan.id)).run();
      db.update(tasks)
        .set({
          stage: "implementation",
          runtimeStatus: "agent_running",
          activePlanVersionId: plan.id,
          currentPlanCommit: 0,
          version: task.version + 1,
          blockedReason: null,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
      visitPhase(relayDatabase, taskId, "build", now);
      db.insert(taskEvents)
        .values({
          taskId,
          type: "plan.approved",
          actor: "user",
          payload: {
            planVersion: plan.version,
            commits: implementationPlanSchema.parse(plan.content).commits.length,
          },
          createdAt: now,
        })
        .run();
      db.insert(orchestrationJobs)
        .values({
          id: randomUUID(),
          taskId,
          type: "implementation.start",
          payload: { planVersionId: plan.id },
          status: "queued",
          idempotencyKey: `${taskId}:implementation:${plan.version}`,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    })();
    return { stage: destination, phase: "build", version: plan.version };
  }

  if (task.stage === "implementation" && destination === "review") {
    assertTransition("implementation", "review", "user");
    if (task.runtimeStatus !== "waiting_for_user") {
      throw new Error("Implementation is not ready for review");
    }
    const ready = db
      .select({ id: taskEvents.id })
      .from(taskEvents)
      .where(
        and(
          eq(taskEvents.taskId, taskId),
          inArray(taskEvents.type, [
            "implementation.ready_for_review",
            "review.changes_ready_for_review",
          ]),
        ),
      )
      .orderBy(desc(taskEvents.id))
      .get();
    if (!ready) throw new Error("Implementation has not completed validation");
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      db.update(tasks)
        .set({
          stage: "review",
          runtimeStatus: "waiting_for_user",
          version: task.version + 1,
          blockedReason: null,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
      visitPhase(relayDatabase, taskId, "review", now);
      db.insert(taskEvents)
        .values({
          taskId,
          type: "implementation.moved_to_review",
          actor: "user",
          payload: {},
          createdAt: now,
        })
        .run();
    })();
    return { stage: destination, phase: "review" };
  }

  if (task.stage === "review" && destination === "ready_to_deploy") {
    assertTransition("review", "ready_to_deploy", "user");
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      db.update(tasks)
        .set({
          stage: "ready_to_deploy",
          runtimeStatus: "idle",
          version: task.version + 1,
          blockedReason: null,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
      visitPhase(relayDatabase, taskId, "deploy", now);
      db.insert(taskEvents)
        .values({
          taskId,
          type: "implementation.approved",
          actor: "user",
          payload: {},
          createdAt: now,
        })
        .run();
    })();
    return { stage: destination, phase: "deploy" };
  }

  throw new Error(`Task cannot move from ${task.stage} to ${destination}`);
}

export function visitPhase(
  relayDatabase: RelayDatabase,
  taskId: string,
  phase: "refine" | "plan" | "build" | "review" | "deploy" | "done",
  now = new Date().toISOString(),
): void {
  relayDatabase.db
    .insert(taskPhaseVisits)
    .values({ taskId, phase, firstStartedAt: now, lastStartedAt: now })
    .onConflictDoUpdate({
      target: [taskPhaseVisits.taskId, taskPhaseVisits.phase],
      set: { lastStartedAt: now },
    })
    .run();
}
