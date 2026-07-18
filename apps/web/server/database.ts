import { join } from "node:path";

import { createDatabase } from "@relay/db";

import { relayDataDir } from "./runtime";

const globalDatabase = globalThis as typeof globalThis & {
  relayDatabase?: ReturnType<typeof createDatabase>;
};

export function database() {
  globalDatabase.relayDatabase ??= createDatabase(join(relayDataDir(), "relay.db"));
  return globalDatabase.relayDatabase;
}
