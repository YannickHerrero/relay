import { projects } from "@relay/db";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { database } from "@/server/database";
import { formRedirect, isFormSubmission, readRequestBody } from "@/server/form-request";
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
  const formSubmission = isFormSubmission(request);
  try {
    assertMutationOrigin(request);
    const id = await createProject(projectInputSchema.parse(await readRequestBody(request)));
    return formSubmission
      ? formRedirect(`/projects/${id}`)
      : NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (formSubmission) return formRedirect("/projects?error=register-failed");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to register project" },
      { status: 400 },
    );
  }
}
