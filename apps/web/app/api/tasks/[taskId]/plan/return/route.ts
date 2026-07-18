import { taskEvents, tasks } from "@relay/db";
import { assertTransition } from "@relay/domain";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { assertMutationOrigin } from "@/server/security";
import { visitPhase } from "@/server/task-transitions";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const { taskId } = await context.params;
    const relayDatabase = database();
    const { db, sqlite } = relayDatabase;
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task || task.stage !== "planning") throw new Error("Task is not in planning");
    assertTransition("planning", "refinement", "user");
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      db.update(tasks)
        .set({
          stage: "refinement",
          runtimeStatus: "waiting_for_user",
          version: task.version + 1,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
      visitPhase(relayDatabase, taskId, "refine", now);
      db.insert(taskEvents)
        .values({
          taskId,
          type: "plan.returned_to_refinement",
          actor: "user",
          payload: {},
          createdAt: now,
        })
        .run();
    })();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to return to refinement" },
      { status: 400 },
    );
  }
}
