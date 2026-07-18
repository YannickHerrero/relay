#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Socket } from "node:net";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serviceCommand = join(rootDirectory, "scripts", "relay-service.sh");
const tailscaleCommand = join(rootDirectory, "scripts", "relay-tailscale.sh");
const dataDirectory = resolveHome(process.env.RELAY_DATA_DIR?.trim() || "~/.relay");
const port = Number.parseInt(process.env.PORT ?? "43127", 10);
const jsonOutput = process.argv.includes("--json");

const serviceLoaded = commandSucceeds(serviceCommand, ["is-loaded"]);
const serviceOwned = commandSucceeds(serviceCommand, ["is-owned"]);
const buildAvailable = existsSync(join(rootDirectory, "apps", "web", ".next", "BUILD_ID"));
const webReachable = await canConnect("127.0.0.1", port, 500);
const worker = readWorkerStatus(join(dataDirectory, "worker-heartbeat.json"));
const tailscale = readTailscaleStatus();
const state = deriveState({ serviceLoaded, webReachable, workerOnline: worker.online, tailscale });

const status = {
  schemaVersion: 1,
  state,
  updatedAt: new Date().toISOString(),
  buildAvailable,
  service: { loaded: serviceLoaded, owned: serviceOwned },
  web: { reachable: webReachable, port },
  worker,
  tailscale,
};

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(status)}\n`);
} else {
  const labels = {
    running: "Running",
    stopped: buildAvailable ? "Stopped" : "Build required",
    degraded: "Degraded",
    unmanaged: "Running outside Companion",
  };
  process.stdout.write(
    [
      `Relay: ${labels[state]}`,
      `Web: ${webReachable ? "online" : "offline"}`,
      `Worker: ${worker.online ? "online" : "offline"}`,
      `Tailscale Serve: ${tailscale.state}`,
      `LaunchAgent: ${serviceLoaded ? "loaded" : "stopped"}${serviceOwned ? ", Relay-owned" : ""}`,
      "",
    ].join("\n"),
  );
}

function commandSucceeds(command, args) {
  try {
    execFileSync(command, args, { stdio: "ignore", env: process.env });
    return true;
  } catch {
    return false;
  }
}

function readTailscaleStatus() {
  try {
    const output = execFileSync(tailscaleCommand, ["status-json"], {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(output);
  } catch {
    return {
      state: "unavailable",
      origin: process.env.RELAY_ORIGIN ?? null,
      target: `http://127.0.0.1:${port}`,
    };
  }
}

function readWorkerStatus(path) {
  try {
    const heartbeat = JSON.parse(readFileSync(path, "utf8"));
    const heartbeatTime = new Date(heartbeat.at).getTime();
    const ageMs = Date.now() - heartbeatTime;
    return {
      online: Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 15_000,
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
      agentReady: typeof heartbeat.agentReady === "boolean" ? heartbeat.agentReady : null,
      agentStatus: typeof heartbeat.agentStatus === "string" ? heartbeat.agentStatus : null,
    };
  } catch {
    return { online: false, ageMs: null, agentReady: null, agentStatus: null };
  }
}

function deriveState({ serviceLoaded: loaded, webReachable: web, workerOnline, tailscale: serve }) {
  if (!loaded && web) return "unmanaged";
  if (!loaded) return "stopped";
  return web && workerOnline && serve.state === "active" ? "running" : "degraded";
}

function canConnect(host, targetPort, timeoutMs) {
  return new Promise((complete) => {
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65_535) {
      complete(false);
      return;
    }
    const socket = new Socket();
    let completed = false;
    const finish = (result) => {
      if (completed) return;
      completed = true;
      socket.destroy();
      complete(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(targetPort, host);
  });
}

function resolveHome(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}
