import { randomUUID } from "node:crypto";

import {
  deploymentConfirmations,
  deployments,
  orchestrationJobs,
  taskEvents,
  tasks,
} from "@relay/db";
import { assertTransition, deploymentRecipeSchema } from "@relay/domain";
import { and, eq, gt, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { assertMutationOrigin } from "@/server/security";

const bodySchema = z.object({ confirmationId: z.string().uuid() });

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const { taskId } = await context.params;
    const { confirmationId } = bodySchema.parse(await request.json());
    const { db, sqlite } = database();
    const now = new Date().toISOString();
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task || task.stage !== "ready_to_deploy") throw new Error("Task is not ready to deploy");
    assertTransition("ready_to_deploy", "deploying", "user");
    const confirmation = db
      .select()
      .from(deploymentConfirmations)
      .where(
        and(
          eq(deploymentConfirmations.id, confirmationId),
          eq(deploymentConfirmations.taskId, taskId),
          isNull(deploymentConfirmations.usedAt),
          gt(deploymentConfirmations.expiresAt, now),
        ),
      )
      .get();
    if (!confirmation) throw new Error("Deployment confirmation is invalid or expired");
    const recipe = deploymentRecipeSchema.parse(confirmation.recipeSnapshot);
    const deploymentId = randomUUID();
    sqlite.transaction(() => {
      const consumed = sqlite
        .prepare(
          "UPDATE deployment_confirmations SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?",
        )
        .run(now, confirmationId, now);
      if (consumed.changes !== 1) throw new Error("Deployment confirmation was already used");
      db.insert(deployments)
        .values({
          id: deploymentId,
          taskId,
          recipeId: recipe.id,
          recipeSnapshot: recipe,
          status: "pending",
          commitSha: confirmation.commitSha,
          createdAt: now,
        })
        .run();
      db.update(tasks)
        .set({
          stage: "deploying",
          runtimeStatus: "agent_running",
          version: task.version + 1,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
      db.insert(taskEvents)
        .values({
          taskId,
          type: "deployment.confirmed",
          actor: "user",
          payload: { deploymentId, recipeId: recipe.id, commitSha: confirmation.commitSha },
          createdAt: now,
        })
        .run();
      db.insert(orchestrationJobs)
        .values({
          id: randomUUID(),
          taskId,
          type: "deployment.run",
          payload: { deploymentId },
          status: "queued",
          idempotencyKey: `${taskId}:deployment:${deploymentId}`,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    })();
    return NextResponse.json({ deploymentId }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start deployment" },
      { status: 400 },
    );
  }
}
