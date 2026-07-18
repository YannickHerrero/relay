import { spawn } from "node:child_process";
import { once } from "node:events";

export type ProcessOutput = {
  stream: "stdout" | "stderr";
  chunk: string;
  at: string;
};

export type RunCommandOptions = {
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStart?: (pid: number) => void;
  onOutput?: (output: ProcessOutput) => void;
};

export type CommandResult = {
  command: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
};

export async function runCommand(options: RunCommandOptions): Promise<CommandResult> {
  const startedAt = Date.now();
  const child = spawn("/bin/bash", ["-lc", options.command], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.pid) options.onStart?.(child.pid);

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let aborted = false;

  child.stdout.on("data", (buffer: Buffer) => {
    const chunk = buffer.toString();
    stdout += chunk;
    options.onOutput?.({ stream: "stdout", chunk, at: new Date().toISOString() });
  });
  child.stderr.on("data", (buffer: Buffer) => {
    const chunk = buffer.toString();
    stderr += chunk;
    options.onOutput?.({ stream: "stderr", chunk, at: new Date().toISOString() });
  });

  const stop = () => terminateProcessGroup(child.pid);
  const abortHandler = () => {
    aborted = true;
    stop();
  };
  options.signal?.addEventListener("abort", abortHandler, { once: true });
  const timeout = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        stop();
      }, options.timeoutMs)
    : undefined;

  // @types/node can be duplicated by native dependencies; spawned processes are EventEmitters at runtime.
  const lifecycle = child as unknown as NodeJS.EventEmitter;
  const [exitCode, signal] = (await once(lifecycle, "close").finally(() => {
    if (timeout) clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortHandler);
  })) as [number | null, NodeJS.Signals | null];

  return {
    command: options.command,
    exitCode,
    signal,
    stdout,
    stderr,
    durationMs: Date.now() - startedAt,
    timedOut,
    aborted,
  };
}

export function terminateProcessGroup(pid?: number): void {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // The process group already exited.
    }
  }, 2_000);
  timer.unref();
}
