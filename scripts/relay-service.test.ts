import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { mkdtempSync, rmSync } from "node:fs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const serviceScript = join(repositoryRoot, "scripts", "relay-service.sh");
const controlScript = join(repositoryRoot, "scripts", "relay-control.sh");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Relay LaunchAgent service", () => {
  test("creates an owned definition and starts and stops only that service", () => {
    const fixture = serviceFixture();

    const firstStart = run(serviceScript, ["start"], fixture.environment);
    expect(firstStart.stdout).toContain("started");
    expect(existsSync(fixture.statePath)).toBe(true);
    expect(run(serviceScript, ["is-owned"], fixture.environment).status).toBe(0);

    const plist = readFileSync(fixture.plistPath, "utf8");
    expect(plist).toContain("<key>RelayManagedService</key><true/>");
    expect(plist).toContain(fixture.rootDirectory);
    expect(plist).toContain(fixture.pnpmPath);

    const secondStart = run(serviceScript, ["start"], fixture.environment);
    expect(secondStart.stdout).toContain("already loaded");

    const stopped = run(serviceScript, ["stop"], fixture.environment);
    expect(stopped.stdout).toContain("stopped");
    expect(existsSync(fixture.statePath)).toBe(false);
  });

  test("refuses an unrelated LaunchAgent definition", () => {
    const fixture = serviceFixture();
    mkdirSync(dirname(fixture.plistPath), { recursive: true });
    writeFileSync(
      fixture.plistPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Label</key><string>com.yannickherrero.relay</string></dict></plist>`,
    );

    const result = run(serviceScript, ["start"], fixture.environment);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to replace an unrelated LaunchAgent");
    expect(existsSync(fixture.statePath)).toBe(false);
  });
});

describe("Relay lifecycle controller", () => {
  test("rolls back a newly started service when Tailscale setup fails", () => {
    const directory = temporaryDirectory();
    const calls = join(directory, "calls");
    const service = executable(
      directory,
      "service",
      `#!/bin/bash
echo "service:$1" >>"$CALLS"
case "$1" in validate|start|stop) exit 0;; is-loaded) exit 1;; esac
`,
    );
    const tailscale = executable(
      directory,
      "tailscale",
      `#!/bin/bash
echo "tailscale:$1" >>"$CALLS"
exit 1
`,
    );

    const result = run(controlScript, ["start"], {
      ...process.env,
      CALLS: calls,
      RELAY_SERVICE_COMMAND: service,
      RELAY_TAILSCALE_COMMAND: tailscale,
    });

    expect(result.status).toBe(1);
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual([
      "service:validate",
      "service:is-loaded",
      "service:start",
      "tailscale:start",
      "service:stop",
    ]);
  });

  test("attempts to remove Relay Serve even when service shutdown fails", () => {
    const directory = temporaryDirectory();
    const calls = join(directory, "calls");
    const service = executable(
      directory,
      "service",
      `#!/bin/bash
echo "service:$1" >>"$CALLS"
exit 1
`,
    );
    const tailscale = executable(
      directory,
      "tailscale",
      `#!/bin/bash
echo "tailscale:$1" >>"$CALLS"
exit 0
`,
    );

    const result = run(controlScript, ["stop"], {
      ...process.env,
      CALLS: calls,
      RELAY_SERVICE_COMMAND: service,
      RELAY_TAILSCALE_COMMAND: tailscale,
    });

    expect(result.status).toBe(1);
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual([
      "service:stop",
      "tailscale:stop",
    ]);
  });
});

function serviceFixture() {
  const directory = temporaryDirectory();
  const rootDirectory = join(directory, "relay");
  const launchAgents = join(directory, "LaunchAgents");
  const statePath = join(directory, "loaded");
  const callsPath = join(directory, "launchctl-calls");
  const pnpmPath = executable(directory, "pnpm", "#!/bin/bash\nexit 0\n");
  const launchctlPath = executable(
    directory,
    "launchctl",
    `#!/bin/bash
echo "$*" >>"$CALLS_PATH"
case "$1" in
  print) test -f "$STATE_PATH";;
  bootstrap) touch "$STATE_PATH";;
  bootout) rm -f "$STATE_PATH";;
  *) exit 1;;
esac
`,
  );
  mkdirSync(join(rootDirectory, "apps", "web", ".next"), { recursive: true });
  writeFileSync(join(rootDirectory, "apps", "web", ".next", "BUILD_ID"), "test");
  const plistPath = join(launchAgents, "com.yannickherrero.relay.plist");

  return {
    rootDirectory,
    statePath,
    pnpmPath,
    plistPath,
    environment: {
      ...process.env,
      CALLS_PATH: callsPath,
      HOME: directory,
      PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
      RELAY_DATA_DIR: join(directory, "data"),
      RELAY_LAUNCH_AGENTS_DIR: launchAgents,
      RELAY_LAUNCHCTL_COMMAND: launchctlPath,
      RELAY_PNPM_COMMAND: pnpmPath,
      RELAY_ROOT_DIRECTORY: rootDirectory,
      STATE_PATH: statePath,
    },
  };
}

function executable(directory: string, name: string, contents: string): string {
  const path = join(directory, name);
  writeFileSync(path, contents);
  chmodSync(path, 0o700);
  return path;
}

function run(command: string, arguments_: string[], environment: NodeJS.ProcessEnv) {
  return spawnSync(command, arguments_, { encoding: "utf8", env: environment });
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "relay-service-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
