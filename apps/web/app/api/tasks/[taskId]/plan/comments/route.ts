import { randomUUID } from "node:crypto";

import { planComments, planVersions, tasks } from "@relay/db";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { assertMutationOrigin } from "@/server/security";

const bodySchema = z.object({
  targetType: z.enum(["global", "commit", "file", "test", "assumption", "dependency"]),
  targetId: z.string().max(300).optional(),
  content: z.string().trim().min(1).max(10_000),
});

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const { taskId } = await context.params;
    const input = bodySchema.parse(await request.json());
    const { db } = database();
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task || task.stage !== "planning") throw new Error("Task is not in planning");
    const plan = db
      .select()
      .from(planVersions)
      .where(eq(planVersions.taskId, taskId))
      .orderBy(desc(planVersions.version))
      .get();
    if (!plan) throw new Error("No plan is available for comments");
    const id = randomUUID();
    db.insert(planComments)
      .values({
        id,
        planVersionId: plan.id,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        content: input.content,
        createdAt: new Date().toISOString(),
      })
      .run();
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to add comment" },
      { status: 400 },
    );
  }
}
