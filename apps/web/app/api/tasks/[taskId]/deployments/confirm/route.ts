import { randomUUID } from "node:crypto";

import {
  deploymentConfirmations,
  projectConfigVersions,
  projects,
  taskCommits,
  tasks,
} from "@relay/db";
import { projectConfigSchema } from "@relay/domain";
import { GitRepository } from "@relay/git";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { assertMutationOrigin } from "@/server/security";

const bodySchema = z.object({ recipeId: z.string().min(1).max(100) });

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const { taskId } = await context.params;
    const { recipeId } = bodySchema.parse(await request.json());
    const { db } = database();
    const row = db
      .select({ task: tasks, project: projects })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, taskId), eq(tasks.stage, "ready_to_deploy")))
      .get();
    if (!row?.task.worktreePath) throw new Error("Task is not ready to deploy");
    const configRow = db
      .select()
      .from(projectConfigVersions)
      .where(eq(projectConfigVersions.projectId, row.project.id))
      .orderBy(desc(projectConfigVersions.version))
      .get();
    const config = projectConfigSchema.parse(configRow?.content);
    const recipe = config.deploymentRecipes.find((candidate) => candidate.id === recipeId);
    if (!recipe)
      throw new Error("Deployment recipe not found in the current project configuration");
    const latestCommit = db
      .select()
      .from(taskCommits)
      .where(eq(taskCommits.taskId, taskId))
      .orderBy(desc(taskCommits.order))
      .get();
    if (!latestCommit) throw new Error("Deployment requires an implementation commit");
    const worktree = new GitRepository(row.task.worktreePath);
    await worktree.assertClean();
    const head = await worktree.head();
    if (head !== latestCommit.sha)
      throw new Error("Worktree HEAD does not match Relay's reviewed commit");
    const id = randomUUID();
    const now = new Date();
    db.insert(deploymentConfirmations)
      .values({
        id,
        taskId,
        recipeId,
        recipeSnapshot: recipe,
        commitSha: head,
        expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
        createdAt: now.toISOString(),
      })
      .run();
    return NextResponse.json({
      confirmationId: id,
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      action: {
        label: recipe.label,
        environment: recipe.environment,
        commitSha: head,
        commands:
          recipe.kind === "git_push"
            ? ["git push --set-upstream origin <task-branch>"]
            : recipe.commands,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to prepare deployment" },
      { status: 400 },
    );
  }
}
