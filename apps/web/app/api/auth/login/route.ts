import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticate, createSession } from "@/server/auth";
import { assertMutationOrigin } from "@/server/security";

const bodySchema = z.object({ password: z.string().min(1).max(256) });

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const { password } = bodySchema.parse(await request.json());
    const result = await authenticate(password);
    if (result.status === "rate_limited") {
      const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
      return NextResponse.json(
        {
          error: `Too many login attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        },
        {
          status: 429,
          headers: { "Retry-After": String(result.retryAfterSeconds) },
        },
      );
    }
    if (result.status === "invalid") {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }
    await createSession(result.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sign in" },
      { status: 400 },
    );
  }
}
