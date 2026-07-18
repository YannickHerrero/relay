import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { relayHealth } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await relayHealth());
}
