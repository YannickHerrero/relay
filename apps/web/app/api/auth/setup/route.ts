import { NextResponse } from "next/server";
import { z } from "zod";

import { createOwner, createSession, hasOwner } from "@/server/auth";
import { database } from "@/server/database";
import { formRedirect, isFormSubmission, readRequestBody } from "@/server/form-request";
import { assertMutationOrigin } from "@/server/security";
import { users } from "@relay/db";

const bodySchema = z.object({ password: z.string().min(4).max(256) });

export async function POST(request: Request) {
  const formSubmission = isFormSubmission(request);
  try {
    assertMutationOrigin(request);
    if (await hasOwner()) {
      return formSubmission
        ? formRedirect("/login")
        : NextResponse.json({ error: "Relay is already set up" }, { status: 409 });
    }
    const { password } = bodySchema.parse(await readRequestBody(request));
    await createOwner(password);
    const owner = database().db.select({ id: users.id }).from(users).get();
    if (!owner) throw new Error("Owner setup failed");
    await createSession(owner.id);
    return formSubmission
      ? formRedirect("/board")
      : NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (formSubmission) {
      return formRedirect(
        `/setup?error=${error instanceof z.ZodError ? "invalid-password" : "invalid-request"}`,
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to set up Relay" },
      { status: 400 },
    );
  }
}
