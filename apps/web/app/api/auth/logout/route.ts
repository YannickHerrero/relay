import { NextResponse } from "next/server";

import { destroySession } from "@/server/auth";
import { assertMutationOrigin } from "@/server/security";

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to sign out" }, { status: 400 });
  }
}
