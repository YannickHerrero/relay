import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/server/auth";
import { relayHealth } from "@/server/health";

export default async function RelayLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return <AppShell initialHealth={await relayHealth()}>{children}</AppShell>;
}
