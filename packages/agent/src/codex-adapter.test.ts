import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CodexAdapter } from "./codex-adapter";

describe("Codex App Server adapter", () => {
  it("normalizes a stdio turn into Relay events", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-codex-"));
    const server = join(root, "fake-app-server.mjs");
    await writeFile(
      server,
      `import readline from "node:readline";
const lines = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: { userAgent: "fake", codexHome: "/tmp", platformFamily: "unix", platformOs: "macos" } });
  if (message.method === "thread/start") send({ id: message.id, result: { thread: { id: "thread-1" } } });
  if (message.method === "turn/start") {
    send({ id: message.id, result: { turn: { id: "turn-1" } } });
    queueMicrotask(() => {
      send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "hello" } });
      send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", items: [{ type: "agentMessage", text: "hello" }] } } });
    });
  }
});`,
    );
    const adapter = new CodexAdapter({ command: process.execPath, args: [server] });
    const session = await adapter.createSession({
      role: "product-refiner",
      cwd: root,
      systemPrompt: "Refine",
      sandbox: "read-only",
      approvalPolicy: "never",
    });
    const events = [];
    for await (const event of adapter.runTurn({ sessionId: session.id, prompt: "Hello" }))
      events.push(event);
    expect(events).toContainEqual({ type: "message.delta", text: "hello" });
    expect(events.at(-1)).toEqual({ type: "turn.completed", output: "hello" });
    await adapter.close();
  });
});
