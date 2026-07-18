import { readFile, realpath } from "node:fs/promises";
import { relative } from "node:path";

import { artifacts } from "@relay/db";
import { eq } from "drizzle-orm";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { relayDataDir } from "@/server/runtime";

export async function GET(_request: Request, context: { params: Promise<{ artifactId: string }> }) {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const { artifactId } = await context.params;
  const artifact = database().db.select().from(artifacts).where(eq(artifacts.id, artifactId)).get();
  if (!artifact) return new Response("Not found", { status: 404 });
  try {
    const path = await realpath(artifact.path);
    const contained = relative(await realpath(relayDataDir()), path);
    if (contained.startsWith("..") || contained.startsWith("/")) throw new Error("Artifact path escaped Relay data");
    return new Response(await readFile(path), { headers: { "content-type": artifact.mimeType ?? "application/octet-stream", "content-disposition": `inline; filename="${safeFilename(path.split("/").at(-1) ?? "artifact")}"`, "cache-control": "private, no-store" } });
  } catch {
    return new Response("Artifact is unavailable", { status: 404 });
  }
}

function safeFilename(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/g, "-"); }
