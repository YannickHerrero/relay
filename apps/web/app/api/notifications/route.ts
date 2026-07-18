import { notifications } from "@relay/db";
import { desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { assertMutationOrigin } from "@/server/security";

export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { db } = database();
  return NextResponse.json({
    items: db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(50).all(),
    unread: db
      .select({ id: notifications.id })
      .from(notifications)
      .where(isNull(notifications.readAt))
      .all().length,
  });
}

const bodySchema = z.object({ id: z.string().uuid().optional(), all: z.boolean().optional() });

export async function PATCH(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const input = bodySchema.parse(await request.json());
    const now = new Date().toISOString();
    const query = database().db.update(notifications).set({ readAt: now });
    if (input.id) query.where(eq(notifications.id, input.id)).run();
    else if (input.all) query.where(isNull(notifications.readAt)).run();
    else throw new Error("Select a notification to mark read");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update notifications" },
      { status: 400 },
    );
  }
}
