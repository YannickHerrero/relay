import { randomUUID } from "node:crypto";

import { orchestrationJobs, planVersions, taskEvents, tasks } from "@relay/db";
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
    if (!task || task.stage !== "planning") throw new Error("Task is not in planning");
    const plan = db
      .select()
      .from(planVersions)
      .where(eq(planVersions.taskId, taskId))
      .orderBy(desc(planVersions.version))
      .get();
    if (!plan) throw new Error("No plan is available to revise");
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      db.update(tasks)
        .set({ runtimeStatus: "agent_running", updatedAt: now, lastActivityAt: now })
        .where(eq(tasks.id, taskId))
        .run();
      db.insert(taskEvents)
        .values({
          taskId,
          type: "plan.revision_requested",
          actor: "user",
          payload: { fromVersion: plan.version },
          createdAt: now,
        })
        .run();
      db.insert(orchestrationJobs)
        .values({
          id: randomUUID(),
          taskId,
          type: "planning.revise",
          payload: { fromVersionId: plan.id },
          status: "queued",
          idempotencyKey: `${taskId}:plan-revision:${plan.version + 1}`,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: orchestrationJobs.idempotencyKey })
        .run();
    })();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to request revision" },
      { status: 400 },
    );
  }
}
