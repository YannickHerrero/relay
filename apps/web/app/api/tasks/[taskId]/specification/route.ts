import { randomUUID } from "node:crypto";

import { refinedRequirementSchema } from "@relay/domain";
import { requirementDrafts, taskEvents, tasks } from "@relay/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { assertMutationOrigin } from "@/server/security";

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const { taskId } = await context.params;
    const content = refinedRequirementSchema.parse(await request.json());
    const { db, sqlite } = database();
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task || task.stage !== "refinement")
      throw new Error("Only a draft requirement can be edited");
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      db.insert(requirementDrafts)
        .values({ taskId, content, updatedAt: now })
        .onConflictDoUpdate({ target: requirementDrafts.taskId, set: { content, updatedAt: now } })
        .run();
      db.update(tasks)
        .set({ updatedAt: now, lastActivityAt: now })
        .where(eq(tasks.id, taskId))
        .run();
      db.insert(taskEvents)
        .values({
          taskId,
          type: "refinement.edited",
          actor: "user",
          payload: { editId: randomUUID() },
          createdAt: now,
        })
        .run();
    })();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update specification" },
      { status: 400 },
    );
  }
}
