import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import { expect, it } from "vitest";

it("stays alive while idle, refreshes its heartbeat, and shuts down cleanly", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "relay-worker-liveness-"));
  const heartbeatPath = join(dataDir, "worker-heartbeat.json");
  const tsxPath = join(process.cwd(), "apps", "worker", "node_modules", ".bin", "tsx");
  const workerPath = join(process.cwd(), "apps", "worker", "src", "index.ts");
  const child = spawn(tsxPath, [workerPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RELAY_AGENT_ADAPTER: "fake",
      RELAY_DATA_DIR: dataDir,
      RELAY_WORKER_CONCURRENCY: "1",
      RELAY_WORKER_HEARTBEAT_INTERVAL_MS: "100",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));

  try {
    const firstHeartbeat = await waitForHeartbeat(heartbeatPath);
    await delay(1_000);
    const secondHeartbeat = await waitForHeartbeat(heartbeatPath);

    expect(child.exitCode, output).toBeNull();
    expect(new Date(secondHeartbeat.at).getTime()).toBeGreaterThan(
      new Date(firstHeartbeat.at).getTime(),
    );

    child.kill("SIGTERM");
    const exit = await waitForExit(child);
    expect(exit.signal, output).toBeNull();
    expect(exit.code, output).toBe(0);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(dataDir, { recursive: true, force: true });
  }
}, 15_000);

type Heartbeat = { workerId: string; startedAt: string; at: string };

async function waitForHeartbeat(path: string): Promise<Heartbeat> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as Heartbeat;
    } catch {
      // The worker may not have created or finished writing the file yet.
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for a fresh worker heartbeat");
}

async function waitForExit(
  child: ReturnType<typeof spawn>,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null) return { code: child.exitCode, signal: child.signalCode };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Worker did not stop after SIGTERM")), 3_000);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}
