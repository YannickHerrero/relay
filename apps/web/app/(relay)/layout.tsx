import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/server/auth";

export default async function RelayLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return <AppShell>{children}</AppShell>;
}
