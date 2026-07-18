import { rm } from "node:fs/promises";
import { join } from "node:path";

import { GitRepository } from "@relay/git";
import { orchestrationJobs, projects, tasks, type RelayDatabase } from "@relay/db";
import { and, eq, inArray } from "drizzle-orm";

import { database } from "./database";
import { relayDataDir } from "./runtime";

export async function deleteTask(
  taskId: string,
  options: { relayDatabase?: RelayDatabase; dataDir?: string } = {},
): Promise<void> {
  const relayDatabase = options.relayDatabase ?? database();
  const dataDir = options.dataDir ?? relayDataDir();
  const { db } = relayDatabase;
  const row = db
    .select({ task: tasks, project: projects })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId))
    .get();
  if (!row) throw new Error("Task not found");
  if (row.task.runtimeStatus === "agent_running" || row.task.stage === "deploying") {
    throw new Error("Stop the active task before deleting it");
  }
  const activeJob = db
    .select({ id: orchestrationJobs.id })
    .from(orchestrationJobs)
    .where(
      and(
        eq(orchestrationJobs.taskId, taskId),
        inArray(orchestrationJobs.status, ["queued", "running"]),
      ),
    )
    .get();
  if (activeJob) throw new Error("Wait for or stop the active task operation before deleting it");

  if (row.task.worktreePath) {
    try {
      await new GitRepository(row.project.repositoryPath).git([
        "worktree",
        "remove",
        "--force",
        row.task.worktreePath,
      ]);
    } catch (error) {
      throw new Error("Unable to detach the task worktree safely", { cause: error });
    }
  }

  db.delete(tasks).where(eq(tasks.id, taskId)).run();
  await Promise.all([
    rm(join(dataDir, "uploads", taskId), { recursive: true, force: true }),
    rm(join(dataDir, "artifacts", taskId), { recursive: true, force: true }),
  ]);
}
