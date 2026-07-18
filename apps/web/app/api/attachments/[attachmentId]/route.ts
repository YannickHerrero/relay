import { readFile, realpath } from "node:fs/promises";
import { relative } from "node:path";

import { taskAttachments } from "@relay/db";
import { eq } from "drizzle-orm";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { relayDataDir } from "@/server/runtime";

export async function GET(
  _request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const { attachmentId } = await context.params;
  const attachment = database()
    .db.select()
    .from(taskAttachments)
    .where(eq(taskAttachments.id, attachmentId))
    .get();
  if (!attachment) return new Response("Not found", { status: 404 });
  try {
    const path = await realpath(attachment.path);
    const contained = relative(await realpath(relayDataDir()), path);
    if (contained.startsWith("..") || contained.startsWith("/"))
      throw new Error("Attachment path escaped Relay data");
    return new Response(await readFile(path), {
      headers: {
        "content-type": attachment.mimeType,
        "content-disposition": `inline; filename="${attachment.originalName.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return new Response("Attachment is unavailable", { status: 404 });
  }
}
