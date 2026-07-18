import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticate, createSession } from "@/server/auth";
import { assertMutationOrigin } from "@/server/security";

const bodySchema = z.object({ password: z.string().min(1).max(256) });

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const { password } = bodySchema.parse(await request.json());
    const userId = await authenticate(password);
    if (!userId) return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    await createSession(userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sign in" },
      { status: 400 },
    );
  }
}
