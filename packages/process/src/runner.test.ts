import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCommand } from "./runner";

describe("command runner", () => {
  it("captures stdout and stderr as observable evidence", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-command-"));
    const chunks: string[] = [];
    const result = await runCommand({
      cwd,
      command: "printf 'ready'; printf 'warning' >&2",
      onOutput: (output) => chunks.push(output.chunk),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ready");
    expect(result.stderr).toBe("warning");
    expect(chunks).toEqual(["ready", "warning"]);
  });

  it("terminates commands that exceed their timeout", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "relay-command-"));
    const result = await runCommand({ cwd, command: "sleep 2", timeoutMs: 25 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });
});
