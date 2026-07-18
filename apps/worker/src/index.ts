import { hostname, homedir } from "node:os";
import { join, resolve } from "node:path";

import { CodexAdapter } from "@relay/agent";
import { FakeAgentAdapter } from "@relay/agent/testing";
import { createDatabase } from "@relay/db";
import { DurableJobQueue, WorkflowEngine, type OrchestrationJob } from "@relay/orchestrator";

const dataDir = resolveDataDir();
const database = createDatabase(join(dataDir, "relay.db"));
const workerId = `${hostname()}:${process.pid}`;
const queue = new DurableJobQueue(database, workerId);
const agent =
  process.env.RELAY_AGENT_ADAPTER === "fake" ? new FakeAgentAdapter() : new CodexAdapter();
const engine = new WorkflowEngine({ database, agent, dataDir });
const concurrency = Math.max(
  1,
  Number.parseInt(process.env.RELAY_WORKER_CONCURRENCY ?? "2", 10) || 2,
);
const active = new Set<Promise<void>>();
let stopping = false;

console.log(`[Relay worker] ${workerId} started with concurrency ${concurrency}`);

const poller = setInterval(() => {
  if (stopping) return;
  while (active.size < concurrency) {
    const job = queue.claim();
    if (!job) break;
    const promise = processJob(job).finally(() => active.delete(promise));
    active.add(promise);
  }
}, 300);
poller.unref();

async function processJob(job: OrchestrationJob): Promise<void> {
  if (job.taskId && !queue.acquireTaskLock(job.taskId)) {
    queue.fail(job, new Error("Another worker owns this task"));
    return;
  }
  const heartbeat = setInterval(() => queue.heartbeat(job.id), 10_000);
  heartbeat.unref();
  try {
    console.log(`[Relay worker] running ${job.type} (${job.id})`);
    await engine.handle(job);
    queue.complete(job.id);
  } catch (error) {
    console.error(`[Relay worker] ${job.type} failed`, error);
    queue.fail(job, error);
    engine.markJobFailure(job, error);
  } finally {
    clearInterval(heartbeat);
    if (job.taskId) queue.releaseTaskLock(job.taskId);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(poller);
  console.log(`[Relay worker] stopping after ${signal}`);
  await Promise.allSettled(active);
  await agent.close();
  database.sqlite.close();
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

function resolveDataDir(): string {
  const value = process.env.RELAY_DATA_DIR?.trim() || "~/.relay";
  return value === "~" || value.startsWith("~/")
    ? resolve(homedir(), value.slice(2))
    : resolve(value);
}
