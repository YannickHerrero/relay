import { NextResponse } from "next/server";
import { z } from "zod";

import { createOwner, createSession, hasOwner } from "@/server/auth";
import { database } from "@/server/database";
import { assertMutationOrigin } from "@/server/security";
import { users } from "@relay/db";

const bodySchema = z.object({ password: z.string().min(4).max(256) });

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    if (await hasOwner())
      return NextResponse.json({ error: "Relay is already set up" }, { status: 409 });
    const { password } = bodySchema.parse(await request.json());
    await createOwner(password);
    const owner = database().db.select({ id: users.id }).from(users).get();
    if (!owner) throw new Error("Owner setup failed");
    await createSession(owner.id);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to set up Relay" },
      { status: 400 },
    );
  }
}
