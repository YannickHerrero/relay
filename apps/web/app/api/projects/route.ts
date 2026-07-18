import { projects } from "@relay/db";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { createProject, projectInputSchema } from "@/server/projects";
import { assertMutationOrigin } from "@/server/security";

export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(
    database().db.select().from(projects).orderBy(desc(projects.updatedAt)).all(),
  );
}

export async function POST(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const id = await createProject(projectInputSchema.parse(await request.json()));
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to register project" },
      { status: 400 },
    );
  }
}
