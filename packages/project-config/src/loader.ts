import { createHash } from "node:crypto";
import { access, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { projectConfigSchema, type ProjectConfig } from "@relay/domain";
import { createJiti } from "jiti";

const configLocations = [".relay/project.config.ts", ".agent-board/project.config.ts"] as const;

export type LoadedProjectConfig = {
  config: ProjectConfig;
  source: string;
  hash: string;
};

export function defineProject(config: ProjectConfig): ProjectConfig {
  return projectConfigSchema.parse(config);
}

export async function loadProjectConfig(repositoryPath: string): Promise<LoadedProjectConfig> {
  if (!isAbsolute(repositoryPath)) {
    throw new Error("Project repository path must be absolute");
  }

  const repositoryRoot = await realpath(repositoryPath);
  for (const relativePath of configLocations) {
    const source = join(repositoryRoot, relativePath);
    try {
      await access(source);
    } catch {
      continue;
    }

    const jiti = createJiti(import.meta.url, { moduleCache: false, interopDefault: true });
    const imported = await jiti.import(source, { default: true });
    const config = projectConfigSchema.parse(imported);
    return {
      config,
      source: relativePath,
      hash: createHash("sha256").update(JSON.stringify(config)).digest("hex"),
    };
  }

  const config = projectConfigSchema.parse({});
  return {
    config,
    source: "Relay defaults",
    hash: createHash("sha256").update(JSON.stringify(config)).digest("hex"),
  };
}
