import { randomUUID } from "node:crypto";

import {
  orchestrationJobs,
  requirementDrafts,
  specificationVersions,
  taskEvents,
  tasks,
} from "@relay/db";
import { assertTransition, refinedRequirementSchema } from "@relay/domain";
import { desc, eq } from "drizzle-orm";
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
    if (!task || task.stage !== "refinement")
      throw new Error("Task is not awaiting requirement approval");
    assertTransition("refinement", "planning", "user");
    const draft = db
      .select()
      .from(requirementDrafts)
      .where(eq(requirementDrafts.taskId, taskId))
      .get();
    const content = refinedRequirementSchema.parse(draft?.content);
    const blocking = content.unresolvedQuestions.filter(
      (question) => question.blocking && question.status === "open",
    );
    if (blocking.length)
      throw new Error(
        `Resolve ${blocking.length} blocking question${blocking.length === 1 ? "" : "s"} first`,
      );
    const previous = db
      .select({ version: specificationVersions.version })
      .from(specificationVersions)
      .where(eq(specificationVersions.taskId, taskId))
      .orderBy(desc(specificationVersions.version))
      .get();
    const now = new Date().toISOString();
    const id = randomUUID();
    const version = (previous?.version ?? 0) + 1;
    sqlite.transaction(() => {
      db.insert(specificationVersions)
        .values({ id, taskId, version, content, approvedAt: now, createdAt: now })
        .run();
      db.update(tasks)
        .set({
          stage: "planning",
          runtimeStatus: "agent_running",
          activeSpecificationVersionId: id,
          version: task.version + 1,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
      db.insert(taskEvents)
        .values({
          taskId,
          type: "requirement.approved",
          actor: "user",
          payload: { specificationVersion: version },
          createdAt: now,
        })
        .run();
      db.insert(orchestrationJobs)
        .values({
          id: randomUUID(),
          taskId,
          type: "planning.start",
          payload: { specificationVersionId: id },
          status: "queued",
          idempotencyKey: `${taskId}:planning:${version}`,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    })();
    return NextResponse.json({ specificationVersion: version });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to approve requirement" },
      { status: 400 },
    );
  }
}
