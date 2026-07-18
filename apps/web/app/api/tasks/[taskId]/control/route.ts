import { randomUUID } from "node:crypto";

import { orchestrationJobs, taskEvents, tasks } from "@relay/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { assertMutationOrigin } from "@/server/security";

const bodySchema = z.object({
  action: z.enum(["stop", "resume", "rerun_tests", "block"]),
  reason: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const { taskId } = await context.params;
    const input = bodySchema.parse(await request.json());
    const { db, sqlite } = database();
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task) throw new Error("Task not found");
    if (!["implementation", "review"].includes(task.stage))
      throw new Error("Controls are available during implementation and review");
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      if (input.action === "stop") {
        db.update(tasks)
          .set({ runtimeStatus: "stopped", updatedAt: now, lastActivityAt: now })
          .where(eq(tasks.id, taskId))
          .run();
      } else if (input.action === "block") {
        db.update(tasks)
          .set({
            runtimeStatus: "blocked",
            blockedReason: input.reason || "Blocked by owner",
            updatedAt: now,
            lastActivityAt: now,
          })
          .where(eq(tasks.id, taskId))
          .run();
      } else {
        db.update(tasks)
          .set({
            runtimeStatus: "agent_running",
            blockedReason: null,
            updatedAt: now,
            lastActivityAt: now,
          })
          .where(eq(tasks.id, taskId))
          .run();
        const type = input.action === "resume" ? "implementation.resume" : "tests.rerun";
        db.insert(orchestrationJobs)
          .values({
            id: randomUUID(),
            taskId,
            type,
            payload: {},
            status: "queued",
            idempotencyKey: `${taskId}:${type}:${now}`,
            availableAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
      db.insert(taskEvents)
        .values({
          taskId,
          type: `control.${input.action}`,
          actor: "user",
          payload: { reason: input.reason },
          createdAt: now,
        })
        .run();
    })();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to control task" },
      { status: 400 },
    );
  }
}
