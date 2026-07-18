import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { agentRuns, orchestrationJobs } from "@relay/db";
import { count, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { relayDataDir } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let heartbeat: { workerId: string; at: string } | undefined;
  try {
    heartbeat = JSON.parse(
      await readFile(join(relayDataDir(), "worker-heartbeat.json"), "utf8"),
    ) as { workerId: string; at: string };
  } catch {
    // A missing heartbeat means the worker has not started yet.
  }
  const ageMs = heartbeat ? Date.now() - new Date(heartbeat.at).getTime() : null;
  const { db } = database();
  const activeAgents =
    db.select({ value: count() }).from(agentRuns).where(eq(agentRuns.status, "running")).get()
      ?.value ?? 0;
  const queuedJobs =
    db
      .select({ value: count() })
      .from(orchestrationJobs)
      .where(inArray(orchestrationJobs.status, ["queued", "running"]))
      .get()?.value ?? 0;
  return NextResponse.json({
    online: ageMs !== null && ageMs < 15_000,
    workerId: heartbeat?.workerId ?? null,
    ageMs,
    activeAgents,
    queuedJobs,
  });
}
