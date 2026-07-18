import type { AgentRole } from "@relay/domain";

export type AgentSandbox = "read-only" | "danger-full-access";

export type CreateSessionInput = {
  role: AgentRole;
  cwd: string;
  systemPrompt: string;
  sandbox: AgentSandbox;
  approvalPolicy: "never";
};

export type AgentSession = {
  id: string;
  role: AgentRole;
  provider: string;
};

export type RunTurnInput = {
  sessionId: string;
  prompt: string;
};

export type AgentEvent =
  | { type: "turn.started"; turnId: string }
  | { type: "message.delta"; text: string }
  | { type: "progress"; text: string }
  | { type: "file.changed"; path: string }
  | { type: "command.started"; command: string }
  | { type: "command.output"; stream: "stdout" | "stderr"; chunk: string }
  | { type: "command.completed"; command: string; exitCode: number | null }
  | { type: "artifact"; path: string; artifactType: string }
  | { type: "turn.completed"; output: string }
  | { type: "error"; message: string };

export interface AgentAdapter {
  createSession(input: CreateSessionInput): Promise<AgentSession>;
  runTurn(input: RunTurnInput): AsyncIterable<AgentEvent>;
  interrupt(sessionId: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
  forkSession(sessionId: string): Promise<AgentSession>;
  close(): Promise<void>;
}
