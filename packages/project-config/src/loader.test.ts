import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadProjectConfig } from "./loader";

describe("project configuration", () => {
  it("loads and validates a Relay TypeScript configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-config-"));
    await mkdir(join(root, ".relay"));
    await writeFile(
      join(root, ".relay/project.config.ts"),
      `export default { commands: { test: undefined, unitTests: ["pnpm test"] }, deploymentRecipes: [{ id: "preview", label: "Preview", commands: ["pnpm deploy"] }] }`,
    );

    const loaded = await loadProjectConfig(await realpath(root));
    expect(loaded.source).toBe(".relay/project.config.ts");
    expect(loaded.config.commands.unitTests).toEqual(["pnpm test"]);
    expect(loaded.config.deploymentRecipes[0]?.requiresConfirmation).toBe(true);
  });

  it("prefers the Relay path and returns safe defaults when absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-config-"));
    const loaded = await loadProjectConfig(root);
    expect(loaded.source).toBe("Relay defaults");
    expect(loaded.config.deploymentRecipes).toEqual([]);
  });
});
