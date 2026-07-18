import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticate, createSession } from "@/server/auth";
import { formRedirect, isFormSubmission, readRequestBody } from "@/server/form-request";
import { assertMutationOrigin } from "@/server/security";

const bodySchema = z.object({ password: z.string().min(1).max(256) });

export async function POST(request: Request) {
  const formSubmission = isFormSubmission(request);
  try {
    assertMutationOrigin(request);
    const { password } = bodySchema.parse(await readRequestBody(request));
    const result = await authenticate(password);
    if (result.status === "rate_limited") {
      const retryHeaders = { "Retry-After": String(result.retryAfterSeconds) };
      if (formSubmission) return formRedirect("/login?error=rate-limited", retryHeaders);
      const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
      return NextResponse.json(
        {
          error: `Too many login attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        },
        { status: 429, headers: retryHeaders },
      );
    }
    if (result.status === "invalid") {
      return formSubmission
        ? formRedirect("/login?error=incorrect-password")
        : NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }
    await createSession(result.userId);
    return formSubmission ? formRedirect("/board") : NextResponse.json({ ok: true });
  } catch (error) {
    if (formSubmission) return formRedirect("/login?error=invalid-request");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sign in" },
      { status: 400 },
    );
  }
}
