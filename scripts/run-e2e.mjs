import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const pnpmCli = process.env.npm_execpath;
const command = pnpmCli ? process.execPath : "pnpm";
const args = pnpmCli
  ? [pnpmCli, "exec", "playwright", "test", ...process.argv.slice(2)]
  : ["exec", "playwright", "test", ...process.argv.slice(2)];
const result = spawnSync(command, args, { stdio: "inherit" });

writeFileSync(
  join(process.cwd(), "apps/web/next-env.d.ts"),
  `/// <reference types="next" />
/// <reference types="next/image-types/global" />
import "./.next/types/routes.d.ts";

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`,
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
