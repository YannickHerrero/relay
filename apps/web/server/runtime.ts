import { homedir } from "node:os";
import { resolve } from "node:path";

export function relayDataDir(): string {
  const configured = process.env.RELAY_DATA_DIR?.trim() || "~/.relay";
  return configured === "~" || configured.startsWith("~/")
    ? resolve(/* turbopackIgnore: true */ homedir(), configured.slice(2))
    : resolve(/* turbopackIgnore: true */ configured);
}
