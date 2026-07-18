import { randomUUID } from "node:crypto";

import { orchestrationJobs, planVersions, taskEvents, tasks } from "@relay/db";
import { assertTransition, implementationPlanSchema } from "@relay/domain";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { assertMutationOrigin } from "@/server/security";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const { taskId } = await context.params;
    const { db, sqlite } = database();
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task || task.stage !== "planning") throw new Error("Task is not awaiting plan approval");
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
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
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
    return NextResponse.json({ planVersion: plan.version });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to approve plan" },
      { status: 400 },
    );
  }
}
