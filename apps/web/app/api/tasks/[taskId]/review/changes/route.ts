import { randomUUID } from "node:crypto";

import { orchestrationJobs, reviewComments, reviewRequests, taskEvents, tasks } from "@relay/db";
import { assertTransition } from "@relay/domain";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { assertMutationOrigin } from "@/server/security";
import { visitPhase } from "@/server/task-transitions";

const bodySchema = z.object({
  comments: z
    .array(
      z.object({
        targetType: z.enum(["global", "file", "commit", "screenshot"]),
        targetId: z.string().max(500).optional(),
        content: z.string().trim().min(1).max(10_000),
      }),
    )
    .min(1)
    .max(20),
});

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const { taskId } = await context.params;
    const input = bodySchema.parse(await request.json());
    const relayDatabase = database();
    const { db, sqlite } = relayDatabase;
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task || task.stage !== "review") throw new Error("Task is not awaiting review");
    assertTransition("review", "implementation", "user");
    const previous = db
      .select({ version: reviewRequests.version })
      .from(reviewRequests)
      .where(eq(reviewRequests.taskId, taskId))
      .orderBy(desc(reviewRequests.version))
      .get();
    const version = (previous?.version ?? 0) + 1;
    const reviewId = randomUUID();
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      db.insert(reviewRequests)
        .values({ id: reviewId, taskId, version, status: "open", createdAt: now })
        .run();
      db.insert(reviewComments)
        .values(
          input.comments.map((comment) => ({
            id: randomUUID(),
            reviewRequestId: reviewId,
            targetType: comment.targetType,
            targetId: comment.targetId ?? null,
            content: comment.content,
            createdAt: now,
          })),
        )
        .run();
      db.update(tasks)
        .set({
          stage: "implementation",
          runtimeStatus: "agent_running",
          version: task.version + 1,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
      visitPhase(relayDatabase, taskId, "build", now);
      db.insert(taskEvents)
        .values({
          taskId,
          type: "review.changes_requested",
          actor: "user",
          payload: { reviewVersion: version, comments: input.comments.length },
          createdAt: now,
        })
        .run();
      db.insert(orchestrationJobs)
        .values({
          id: randomUUID(),
          taskId,
          type: "implementation.review_changes",
          payload: { reviewId },
          status: "queued",
          idempotencyKey: `${taskId}:review:${version}`,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    })();
    return NextResponse.json({ reviewVersion: version }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to request changes" },
      { status: 400 },
    );
  }
}
