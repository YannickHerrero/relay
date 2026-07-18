import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import { projectConfigVersions, projects } from "@relay/db";
import { projectTypeSchema } from "@relay/domain";
import { loadProjectConfig } from "@relay/project-config";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { database } from "./database";

const execFileAsync = promisify(execFile);

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  repositoryPath: z.string().trim().min(1),
  defaultBranch: z.string().trim().min(1).max(200).default("main"),
  projectType: projectTypeSchema,
});

export async function createProject(input: z.infer<typeof projectInputSchema>) {
  const values = projectInputSchema.parse(input);
  const repositoryPath = await realpath(values.repositoryPath);
  await verifyRepository(repositoryPath, values.defaultBranch);
  const loaded = await loadProjectConfig(repositoryPath);
  const now = new Date().toISOString();
  const projectId = randomUUID();
  const { db, sqlite } = database();

  sqlite.transaction(() => {
    db.insert(projects)
      .values({ ...values, id: projectId, repositoryPath, createdAt: now, updatedAt: now })
      .run();
    db.insert(projectConfigVersions)
      .values({
        id: randomUUID(),
        projectId,
        version: 1,
        source: loaded.source,
        hash: loaded.hash,
        content: loaded.config,
        createdAt: now,
      })
      .run();
  })();
  return projectId;
}

export async function refreshProjectConfig(projectId: string) {
  const { db, sqlite } = database();
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new Error("Project not found");
  const loaded = await loadProjectConfig(project.repositoryPath);
  const latest = db
    .select()
    .from(projectConfigVersions)
    .where(eq(projectConfigVersions.projectId, projectId))
    .orderBy(desc(projectConfigVersions.version))
    .get();
  if (latest?.hash === loaded.hash) return latest;
  const now = new Date().toISOString();
  const next = {
    id: randomUUID(),
    projectId,
    version: (latest?.version ?? 0) + 1,
    source: loaded.source,
    hash: loaded.hash,
    content: loaded.config,
    createdAt: now,
  };
  sqlite.transaction(() => {
    db.insert(projectConfigVersions).values(next).run();
    db.update(projects).set({ updatedAt: now }).where(eq(projects.id, projectId)).run();
  })();
  return next;
}

export async function verifyRepository(path: string, branch: string): Promise<void> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", path, "rev-parse", "--show-toplevel"]);
    if ((await realpath(stdout.trim())) !== (await realpath(path))) {
      throw new Error("Path must be the root of a Git repository");
    }
    await execFileAsync("git", ["-C", path, "rev-parse", "--verify", branch]);
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.startsWith("Path must")
        ? error.message
        : `Unable to verify Git repository and branch '${branch}'`,
      { cause: error },
    );
  }
}
