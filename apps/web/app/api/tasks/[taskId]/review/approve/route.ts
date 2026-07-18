import { taskEvents, tasks } from "@relay/db";
import { assertTransition } from "@relay/domain";
import { eq } from "drizzle-orm";
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
    if (!task || task.stage !== "review")
      throw new Error("Task is not awaiting implementation approval");
    assertTransition("review", "ready_to_deploy", "user");
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      db.update(tasks)
        .set({
          stage: "ready_to_deploy",
          runtimeStatus: "idle",
          version: task.version + 1,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
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
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to approve implementation" },
      { status: 400 },
    );
  }
}
