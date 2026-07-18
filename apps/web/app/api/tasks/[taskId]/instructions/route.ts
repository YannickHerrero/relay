import { randomUUID } from "node:crypto";

import { messages, notifications, orchestrationJobs, taskEvents, tasks } from "@relay/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { assertMutationOrigin } from "@/server/security";

const bodySchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  classification: z.enum(["minor_correction", "scope_change"]),
});

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const { taskId } = await context.params;
    const input = bodySchema.parse(await request.json());
    const { db, sqlite } = database();
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task || task.stage !== "implementation")
      throw new Error("Instructions require an implementation task");
    const now = new Date().toISOString();
    const instructionId = randomUUID();
    sqlite.transaction(() => {
      db.insert(messages)
        .values({
          id: instructionId,
          taskId,
          role: "user",
          content: input.content,
          attachments: [],
          createdAt: now,
        })
        .run();
      if (input.classification === "scope_change") {
        db.update(tasks)
          .set({
            runtimeStatus: "blocked",
            blockedReason: "Approved scope revision required",
            updatedAt: now,
            lastActivityAt: now,
          })
          .where(eq(tasks.id, taskId))
          .run();
        db.insert(notifications)
          .values({
            id: randomUUID(),
            taskId,
            type: "scope.revision_needed",
            title: "Scope revision required",
            body: task.title,
            createdAt: now,
          })
          .run();
      } else {
        db.update(tasks)
          .set({ runtimeStatus: "stopped", updatedAt: now, lastActivityAt: now })
          .where(eq(tasks.id, taskId))
          .run();
        db.insert(orchestrationJobs)
          .values({
            id: randomUUID(),
            taskId,
            type: "implementation.instruction",
            payload: { instruction: input.content, instructionId },
            status: "queued",
            idempotencyKey: `${taskId}:instruction:${instructionId}`,
            availableAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
      db.insert(taskEvents)
        .values({
          taskId,
          type:
            input.classification === "scope_change"
              ? "scope.revision_requested"
              : "implementation.instruction_sent",
          actor: "user",
          payload: { instructionId },
          createdAt: now,
        })
        .run();
    })();
    return NextResponse.json({
      status: input.classification === "scope_change" ? "revision_required" : "queued",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to send instruction" },
      { status: 400 },
    );
  }
}
