import { randomUUID } from "node:crypto";

import type { AgentRole } from "@relay/domain";

import type {
  AgentAdapter,
  AgentEvent,
  AgentSession,
  CreateSessionInput,
  RunTurnInput,
} from "./adapter";

export type FakeResponse = string | ((input: RunTurnInput, role: AgentRole) => string);

export class FakeAgentAdapter implements AgentAdapter {
  private readonly sessions = new Map<string, AgentSession>();
  private responseIndex = 0;

  constructor(private readonly responses: FakeResponse[] = []) {}

  async createSession(input: CreateSessionInput): Promise<AgentSession> {
    const session = { id: randomUUID(), role: input.role, provider: "fake" };
    this.sessions.set(session.id, session);
    return session;
  }

  async *runTurn(input: RunTurnInput): AsyncIterable<AgentEvent> {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw new Error("Unknown fake agent session");
    const turnId = randomUUID();
    yield { type: "turn.started", turnId };
    const response = this.responses[this.responseIndex++];
    const output =
      typeof response === "function"
        ? response(input, session.role)
        : (response ??
          `<relay-output>{"summary":"Fake turn completed","deviations":[],"manualChecks":[]}</relay-output>`);
    yield { type: "message.delta", text: output };
    yield { type: "turn.completed", output };
  }

  async interrupt(_sessionId: string): Promise<void> {}
  async resume(_sessionId: string): Promise<void> {}

  async forkSession(sessionId: string): Promise<AgentSession> {
    const source = this.sessions.get(sessionId);
    if (!source) throw new Error("Unknown fake agent session");
    const fork = { ...source, id: randomUUID() };
    this.sessions.set(fork.id, fork);
    return fork;
  }

  async close(): Promise<void> {
    this.sessions.clear();
  }
}
