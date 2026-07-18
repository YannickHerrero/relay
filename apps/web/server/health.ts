import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { agentRuns, orchestrationJobs, type RelayDatabase } from "@relay/db";
import { count, eq, inArray } from "drizzle-orm";

import { database } from "./database";
import { relayDataDir } from "./runtime";

const WORKER_STALE_AFTER_MS = 15_000;

export type RelayHealth = {
  online: boolean;
  workerId: string | null;
  ageMs: number | null;
  activeAgents: number;
  queuedJobs: number;
};

type HealthOptions = {
  dataDir?: string;
  now?: Date;
  relayDatabase?: RelayDatabase;
};

export async function relayHealth(options: HealthOptions = {}): Promise<RelayHealth> {
  const dataDir = options.dataDir ?? relayDataDir();
  const now = options.now ?? new Date();
  const relayDatabase = options.relayDatabase ?? database();
  let heartbeat: { workerId: string; at: string } | undefined;
  try {
    heartbeat = JSON.parse(await readFile(join(dataDir, "worker-heartbeat.json"), "utf8")) as {
      workerId: string;
      at: string;
    };
  } catch {
    // A missing or incomplete heartbeat means the worker has not reported healthy.
  }

  const heartbeatTime = heartbeat ? new Date(heartbeat.at).getTime() : Number.NaN;
  const ageMs = Number.isFinite(heartbeatTime) ? now.getTime() - heartbeatTime : null;
  const { db } = relayDatabase;
  const activeAgents =
    db.select({ value: count() }).from(agentRuns).where(eq(agentRuns.status, "running")).get()
      ?.value ?? 0;
  const queuedJobs =
    db
      .select({ value: count() })
      .from(orchestrationJobs)
      .where(inArray(orchestrationJobs.status, ["queued", "running"]))
      .get()?.value ?? 0;

  return {
    online: ageMs !== null && ageMs >= 0 && ageMs < WORKER_STALE_AFTER_MS,
    workerId: heartbeat?.workerId ?? null,
    ageMs,
    activeAgents,
    queuedJobs,
  };
}
