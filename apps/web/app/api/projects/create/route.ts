import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { createNewProject, projectInputSchema } from "@/server/projects";
import { assertMutationOrigin } from "@/server/security";

export async function POST(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const id = await createNewProject(projectInputSchema.parse(await request.json()));
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create project" },
      { status: 400 },
    );
  }
}
