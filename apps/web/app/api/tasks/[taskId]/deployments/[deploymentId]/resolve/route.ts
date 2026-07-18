import { deployments, taskEvents, tasks } from "@relay/db";
import { assertTransition } from "@relay/domain";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { assertMutationOrigin } from "@/server/security";

const bodySchema = z.object({ action: z.enum(["cancel", "return_to_implementation"]) });

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string; deploymentId: string }> },
) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const input = bodySchema.parse(await request.json());
    const { taskId, deploymentId } = await context.params;
    const { db, sqlite } = database();
    const task = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.stage, "deploying")))
      .get();
    const deployment = db
      .select()
      .from(deployments)
      .where(and(eq(deployments.id, deploymentId), eq(deployments.taskId, taskId)))
      .get();
    if (!task || !deployment || deployment.status !== "failed")
      throw new Error("Only a failed deployment can be resolved");
    const destination = input.action === "cancel" ? "ready_to_deploy" : "implementation";
    assertTransition("deploying", destination, "user");
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      db.update(deployments)
        .set({ status: input.action === "cancel" ? "cancelled" : "fix_requested" })
        .where(eq(deployments.id, deploymentId))
        .run();
      db.update(tasks)
        .set({
          stage: destination,
          runtimeStatus: input.action === "cancel" ? "idle" : "waiting_for_user",
          blockedReason: null,
          version: task.version + 1,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
      db.insert(taskEvents)
        .values({
          taskId,
          type: input.action === "cancel" ? "deployment.cancelled" : "deployment.fix_requested",
          actor: "user",
          payload: { deploymentId },
          createdAt: now,
        })
        .run();
    })();
    return NextResponse.json({ stage: destination });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to resolve deployment" },
      { status: 400 },
    );
  }
}
