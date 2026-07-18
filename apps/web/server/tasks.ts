import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  messages,
  orchestrationJobs,
  projects,
  taskAttachments,
  taskEvents,
  tasks,
} from "@relay/db";
import { taskPrioritySchema, taskTypeSchema } from "@relay/domain";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { database } from "./database";
import { relayDataDir } from "./runtime";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

export const taskInputSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  initialRequest: z.string().trim().min(1).max(50_000),
  type: taskTypeSchema,
  priority: taskPrioritySchema,
  baseBranch: z.string().trim().min(1).max(200),
});

export const taskRequestSchema = z.object({
  projectId: z.string().uuid(),
  request: z.string().trim().min(1).max(50_000),
});

export async function createTaskFromRequest(
  input: z.infer<typeof taskRequestSchema>,
  files: File[],
): Promise<string> {
  const request = taskRequestSchema.parse(input);
  const project = database()
    .db.select()
    .from(projects)
    .where(eq(projects.id, request.projectId))
    .get();
  if (!project) throw new Error("Project not found");
  return createTask(taskValuesFromRequest(request, project.defaultBranch), files);
}

export function taskValuesFromRequest(
  input: z.infer<typeof taskRequestSchema>,
  defaultBranch: string,
): z.infer<typeof taskInputSchema> {
  const request = taskRequestSchema.parse(input);
  return {
    projectId: request.projectId,
    title: deriveTaskTitle(request.request),
    initialRequest: request.request,
    type: "feature",
    priority: "medium",
    baseBranch: defaultBranch,
  };
}

export function deriveTaskTitle(request: string): string {
  const firstLine = request
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) throw new Error("Task request cannot be empty");
  return firstLine.replace(/^#{1,6}\s+/, "").slice(0, 160);
}

export async function createTask(input: z.infer<typeof taskInputSchema>, files: File[]) {
  const values = taskInputSchema.parse(input);
  if (files.length > MAX_ATTACHMENTS) throw new Error(`Attach at most ${MAX_ATTACHMENTS} files`);
  if (files.some((file) => file.size > MAX_ATTACHMENT_BYTES)) {
    throw new Error("Each attachment must be 25 MB or smaller");
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const uploadDir = join(relayDataDir(), "uploads", id);
  await mkdir(uploadDir, { recursive: true });
  const attachmentRows: Array<typeof taskAttachments.$inferInsert> = [];

  try {
    for (const file of files) {
      const attachmentId = randomUUID();
      const safeName = sanitizeFilename(file.name);
      const path = join(uploadDir, `${attachmentId}-${safeName}`);
      await writeFile(path, Buffer.from(await file.arrayBuffer()), { flag: "wx", mode: 0o600 });
      attachmentRows.push({
        id: attachmentId,
        taskId: id,
        type: attachmentType(file.type),
        originalName: safeName,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        path,
        createdAt: now,
      });
    }

    const { db, sqlite } = database();
    sqlite.transaction(() => {
      db.insert(tasks)
        .values({
          ...values,
          id,
          stage: "refinement",
          runtimeStatus: "agent_running",
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      if (attachmentRows.length) db.insert(taskAttachments).values(attachmentRows).run();
      db.insert(messages)
        .values({
          id: randomUUID(),
          taskId: id,
          role: "user",
          content: values.initialRequest,
          attachments: attachmentRows.map((row) => row.id),
          createdAt: now,
        })
        .run();
      db.insert(taskEvents)
        .values({
          taskId: id,
          type: "task.created",
          actor: "user",
          payload: { title: values.title, attachmentCount: attachmentRows.length },
          createdAt: now,
        })
        .run();
      db.insert(orchestrationJobs)
        .values({
          id: randomUUID(),
          taskId: id,
          type: "refinement.start",
          payload: {},
          status: "queued",
          idempotencyKey: `${id}:refinement:1`,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    })();
    return id;
  } catch (error) {
    await rm(uploadDir, { recursive: true, force: true });
    throw error;
  }
}

function sanitizeFilename(value: string): string {
  const name = basename(value)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 120);
  return name || "attachment";
}

function attachmentType(mime: string): "image" | "video" | "log" | "file" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/") || mime.includes("json")) return "log";
  return "file";
}
