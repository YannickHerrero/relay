import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import type {
  AgentAdapter,
  AgentEvent,
  AgentSession,
  CreateSessionInput,
  RunTurnInput,
} from "./adapter";

export type CodexAdapterOptions = {
  command?: string;
  args?: string[];
  requestTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

type JsonObject = Record<string, unknown>;
type JsonRpcMessage = {
  id?: number | string;
  method?: string;
  params?: JsonObject;
  result?: unknown;
  error?: unknown;
};

type TurnState = {
  queue: AsyncQueue<AgentEvent>;
  output: string;
  threadId: string;
};

export class CodexAdapter implements AgentAdapter {
  private transport: CodexTransport | undefined;
  private readonly sessions = new Map<string, AgentSession>();
  private readonly activeTurns = new Map<string, string>();
  private readonly turns = new Map<string, TurnState>();
  private initialized = false;

  constructor(private readonly options: CodexAdapterOptions = {}) {}

  async createSession(input: CreateSessionInput): Promise<AgentSession> {
    const transport = await this.ensureTransport();
    const response = await transport.request("thread/start", {
      cwd: input.cwd,
      approvalPolicy: input.approvalPolicy,
      sandbox: input.sandbox,
      baseInstructions: input.systemPrompt,
      ephemeral: false,
    });
    const thread = asObject(asObject(response).thread);
    const id = asString(thread.id, "Codex thread/start response did not include a thread id");
    const session = { id, role: input.role, provider: "codex" } satisfies AgentSession;
    this.sessions.set(id, session);
    return session;
  }

  async *runTurn(input: RunTurnInput): AsyncIterable<AgentEvent> {
    if (!this.sessions.has(input.sessionId)) throw new Error("Unknown Codex session");
    const transport = await this.ensureTransport();
    const response = await transport.request("turn/start", {
      threadId: input.sessionId,
      input: [{ type: "text", text: input.prompt, text_elements: [] }],
      approvalPolicy: "never",
    });
    const turn = asObject(asObject(response).turn);
    const turnId = asString(turn.id, "Codex turn/start response did not include a turn id");
    const state = { queue: new AsyncQueue<AgentEvent>(), output: "", threadId: input.sessionId };
    this.turns.set(turnId, state);
    this.activeTurns.set(input.sessionId, turnId);
    state.queue.push({ type: "turn.started", turnId });
    transport.flushBacklog(turnId);

    try {
      yield* state.queue;
    } finally {
      this.turns.delete(turnId);
      if (this.activeTurns.get(input.sessionId) === turnId)
        this.activeTurns.delete(input.sessionId);
    }
  }

  async interrupt(sessionId: string): Promise<void> {
    const turnId = this.activeTurns.get(sessionId);
    if (!turnId) return;
    await (await this.ensureTransport()).request("turn/interrupt", { threadId: sessionId, turnId });
  }

  async resume(sessionId: string): Promise<void> {
    await (
      await this.ensureTransport()
    ).request("thread/resume", {
      threadId: sessionId,
      approvalPolicy: "never",
      excludeTurns: true,
    });
  }

  async forkSession(sessionId: string): Promise<AgentSession> {
    const source = this.sessions.get(sessionId);
    if (!source) throw new Error("Unknown Codex session");
    const response = await (
      await this.ensureTransport()
    ).request("thread/fork", {
      threadId: sessionId,
      approvalPolicy: "never",
      excludeTurns: true,
    });
    const thread = asObject(asObject(response).thread);
    const fork = { ...source, id: asString(thread.id, "Codex did not return a forked thread id") };
    this.sessions.set(fork.id, fork);
    return fork;
  }

  async close(): Promise<void> {
    await this.transport?.close();
    this.transport = undefined;
    this.initialized = false;
    this.sessions.clear();
  }

  private async ensureTransport(): Promise<CodexTransport> {
    if (!this.transport) {
      this.transport = new CodexTransport(this.options, (message) =>
        this.handleNotification(message),
      );
    }
    if (!this.initialized) {
      await this.transport.request("initialize", {
        clientInfo: { name: "relay", title: "Relay", version: "0.1.0" },
        capabilities: { experimentalApi: false, requestAttestation: false },
      });
      this.transport.notify("initialized");
      this.initialized = true;
    }
    return this.transport;
  }

  private handleNotification(message: JsonRpcMessage): void {
    const params = message.params ?? {};
    const turnId = stringValue(params.turnId) ?? stringValue(asOptionalObject(params.turn)?.id);
    if (!turnId) return;
    const state = this.turns.get(turnId);
    if (!state) {
      this.transport?.backlog(turnId, message);
      return;
    }

    if (message.method === "item/agentMessage/delta") {
      const delta = stringValue(params.delta) ?? "";
      state.output += delta;
      state.queue.push({ type: "message.delta", text: delta });
    } else if (message.method === "item/commandExecution/outputDelta") {
      state.queue.push({
        type: "command.output",
        stream: "stdout",
        chunk: stringValue(params.delta) ?? "",
      });
    } else if (message.method === "item/started") {
      const item = asOptionalObject(params.item);
      if (item?.type === "commandExecution") {
        state.queue.push({
          type: "command.started",
          command: stringValue(item.command) ?? "command",
        });
      }
    } else if (message.method === "item/completed") {
      const item = asOptionalObject(params.item);
      if (item?.type === "commandExecution") {
        state.queue.push({
          type: "command.completed",
          command: stringValue(item.command) ?? "command",
          exitCode: typeof item.exitCode === "number" ? item.exitCode : null,
        });
      } else if (item?.type === "imageView" && typeof item.path === "string") {
        state.queue.push({ type: "artifact", path: item.path, artifactType: "screenshot" });
      }
    } else if (message.method === "error") {
      const error = asOptionalObject(params.error);
      state.queue.push({
        type: "error",
        message: stringValue(error?.message) ?? "Codex turn failed",
      });
    } else if (message.method === "turn/completed") {
      const turn = asOptionalObject(params.turn);
      const finalOutput = finalAgentMessage(turn) || state.output;
      state.queue.push({ type: "turn.completed", output: finalOutput });
      state.queue.end();
    }
  }
}

class CodexTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private requestId = 0;
  private closed = false;
  private stderr = "";
  private readonly pending = new Map<
    number | string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }
  >();
  private readonly notificationBacklog = new Map<string, JsonRpcMessage[]>();

  constructor(
    options: CodexAdapterOptions,
    private readonly onNotification: (message: JsonRpcMessage) => void,
  ) {
    this.child = spawn(
      options.command ?? process.env.RELAY_CODEX_COMMAND ?? "codex",
      options.args ?? ["app-server", "--stdio"],
      {
        env: { ...process.env, ...options.env },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-8_000);
    });
    this.child.stdout.on("close", () =>
      this.failAll(new Error(`Codex App Server exited. ${this.stderr}`.trim())),
    );
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.receive(line));
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  private readonly requestTimeoutMs: number;

  request(method: string, params: JsonObject): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Codex App Server is closed"));
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.send({ method, id, params });
    });
  }

  notify(method: string, params?: JsonObject): void {
    this.send(params ? { method, params } : { method });
  }

  backlog(turnId: string, message: JsonRpcMessage): void {
    const messages = this.notificationBacklog.get(turnId) ?? [];
    messages.push(message);
    this.notificationBacklog.set(turnId, messages.slice(-100));
  }

  flushBacklog(turnId: string): void {
    for (const message of this.notificationBacklog.get(turnId) ?? []) this.onNotification(message);
    this.notificationBacklog.delete(turnId);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin.end();
    this.child.kill("SIGTERM");
    this.failAll(new Error("Codex App Server closed"));
  }

  private send(message: JsonRpcMessage): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error !== undefined)
        pending.reject(new Error(`Codex request failed: ${JSON.stringify(message.error)}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.send({
        id: message.id,
        error: { code: -32601, message: "Relay does not accept interactive server requests" },
      });
      return;
    }
    if (message.method) this.onNotification(message);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private done = false;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  end(): void {
    this.done = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Codex response");
  return value as JsonObject;
}

function asOptionalObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function asString(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message);
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finalAgentMessage(turn?: JsonObject): string {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  return (
    items
      .map(asOptionalObject)
      .filter((item) => item?.type === "agentMessage")
      .map((item) => stringValue(item?.text) ?? "")
      .filter(Boolean)
      .at(-1) ?? ""
  );
}
