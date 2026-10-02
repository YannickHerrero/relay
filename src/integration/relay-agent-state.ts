// Installed by `relay integration install pi`; reinstalling overwrites it.
// Reports pi's lifecycle (working, blocked, idle) and its session to relay.
// Adapted from herdr's pi extension (Apache-2.0).
// @ts-nocheck

import { execFile } from "node:child_process";
import path from "node:path";

const relayBin = process.env.RELAY_BIN;
const windowId = process.env.RELAY_WINDOW_ID;

function enabled() {
  return process.env.RELAY === "1" && !!relayBin && !!windowId;
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve) => {
    execFile(relayBin!, args, { timeout: 2000 }, () => resolve());
  });
}

let seq = Date.now() * 1000;
let session: string | undefined;

function updateSession(ctx: any): void {
  try {
    const file = ctx?.sessionManager?.getSessionFile?.();
    if (typeof file === "string" && path.isAbsolute(file)) {
      session = file;
      return;
    }
  } catch {}
  try {
    const id = ctx?.sessionManager?.getSessionId?.();
    session = typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    session = undefined;
  }
}

function reportSession(): Promise<void> {
  if (!session) return Promise.resolve();
  return run(["report-session", "--agent", "pi", "--session", session]);
}

type State = "working" | "blocked" | "idle";
let queued: { state: State; seq: number } | undefined;
let sending = false;

function queueState(state: State): void {
  seq += 1;
  queued = { state, seq };
  if (!sending) void drain();
}

async function drain(): Promise<void> {
  sending = true;
  try {
    while (queued) {
      const next = queued;
      queued = undefined;
      await run(["report-state", "--agent", "pi", "--state", next.state, "--seq", String(next.seq)]);
    }
  } finally {
    sending = false;
  }
}

export default function (pi) {
  if (!enabled()) return;

  let active = false;
  let blocked = 0;
  let last: State | undefined;
  let root = false;

  function publish(force = false) {
    const state: State = blocked > 0 ? "blocked" : active ? "working" : "idle";
    if (!force && state === last) return;
    last = state;
    queueState(state);
  }

  pi.events.on("herdr:blocked", (data) => {
    if (!root) return;
    blocked = data?.active ? blocked + 1 : Math.max(0, blocked - 1);
    publish();
  });

  pi.on("session_start", async (_event, ctx) => {
    // Only the interactive UI runs in a terminal relay shows.
    if (ctx?.mode !== "tui") return;
    root = true;
    updateSession(ctx);
    await reportSession();
    active = ctx?.isIdle?.() === false;
    publish(true);
  });

  pi.on("agent_start", (_event, ctx) => {
    if (!root) return;
    updateSession(ctx);
    void reportSession();
    active = true;
    publish();
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!root || ctx?.isIdle?.() !== true) return;
    active = false;
    publish();
  });
}
