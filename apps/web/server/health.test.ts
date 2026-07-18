import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createDatabase } from "@relay/db";
import { afterEach, describe, expect, it } from "vitest";

import { relayHealth } from "./health";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Relay health", () => {
  it("reports a fresh heartbeat as online and a stale heartbeat as offline", async () => {
    const dataDir = await temporaryDataDir();
    const relayDatabase = createDatabase(":memory:");
    const heartbeatAt = new Date("2026-01-01T00:00:00.000Z");
    await writeFile(
      join(dataDir, "worker-heartbeat.json"),
      JSON.stringify({ workerId: "relay-worker:test", at: heartbeatAt.toISOString() }),
    );

    try {
      await expect(
        relayHealth({
          dataDir,
          now: new Date(heartbeatAt.getTime() + 5_000),
          relayDatabase,
        }),
      ).resolves.toMatchObject({
        online: true,
        workerId: "relay-worker:test",
        ageMs: 5_000,
        activeAgents: 0,
        queuedJobs: 0,
      });
      await expect(
        relayHealth({
          dataDir,
          now: new Date(heartbeatAt.getTime() + 15_000),
          relayDatabase,
        }),
      ).resolves.toMatchObject({ online: false, ageMs: 15_000 });
    } finally {
      relayDatabase.sqlite.close();
    }
  });

  it("reports offline when no valid heartbeat exists", async () => {
    const dataDir = await temporaryDataDir();
    const relayDatabase = createDatabase(":memory:");
    try {
      await expect(relayHealth({ dataDir, relayDatabase })).resolves.toMatchObject({
        online: false,
        workerId: null,
        ageMs: null,
      });
    } finally {
      relayDatabase.sqlite.close();
    }
  });
});

async function temporaryDataDir(): Promise<string> {
  const path = join(tmpdir(), `relay-health-${crypto.randomUUID()}`);
  await mkdir(path);
  temporaryDirectories.push(path);
  return path;
}
