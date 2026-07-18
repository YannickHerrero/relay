import { homedir } from "node:os";
import { resolve } from "node:path";

export function relayDataDir(): string {
  return resolveLocalPath(process.env.RELAY_DATA_DIR, "~/.relay");
}

export function relayProjectsDir(): string {
  return resolveLocalPath(process.env.RELAY_PROJECTS_DIR, "~/dev");
}

function resolveLocalPath(value: string | undefined, fallback: string): string {
  const configured = value?.trim() || fallback;
  return configured === "~" || configured.startsWith("~/")
    ? resolve(/* turbopackIgnore: true */ homedir(), configured.slice(2))
    : resolve(/* turbopackIgnore: true */ configured);
}
