import { randomUUID } from "node:crypto";

import { messages, orchestrationJobs, taskEvents, tasks } from "@relay/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { assertMutationOrigin } from "@/server/security";

const bodySchema = z.object({ content: z.string().trim().min(1).max(50_000) });

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const { taskId } = await context.params;
    const { content } = bodySchema.parse(await request.json());
    const { db, sqlite } = database();
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task || task.stage !== "refinement")
      throw new Error("Messages can only refine an active requirement");
    const now = new Date().toISOString();
    const messageId = randomUUID();
    sqlite.transaction(() => {
      db.insert(messages)
        .values({
          id: messageId,
          taskId,
          role: "user",
          phase: "refine",
          content,
          attachments: [],
          createdAt: now,
        })
        .run();
      db.update(tasks)
        .set({ runtimeStatus: "agent_running", updatedAt: now, lastActivityAt: now })
        .where(eq(tasks.id, taskId))
        .run();
      db.insert(taskEvents)
        .values({
          taskId,
          type: "refinement.message_sent",
          actor: "user",
          payload: { messageId },
          createdAt: now,
        })
        .run();
      db.insert(orchestrationJobs)
        .values({
          id: randomUUID(),
          taskId,
          type: "refinement.message",
          payload: { messageId },
          status: "queued",
          idempotencyKey: `${taskId}:message:${messageId}`,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    })();
    return NextResponse.json({ id: messageId }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to send message" },
      { status: 400 },
    );
  }
}
