import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { formRedirect, isFormSubmission, readRequestBody } from "@/server/form-request";
import { createNewProject, projectInputSchema } from "@/server/projects";
import { assertMutationOrigin } from "@/server/security";

export async function POST(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const formSubmission = isFormSubmission(request);
  try {
    assertMutationOrigin(request);
    const id = await createNewProject(projectInputSchema.parse(await readRequestBody(request)));
    return formSubmission
      ? formRedirect(`/projects/${id}`)
      : NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (formSubmission) return formRedirect("/projects/new?error=create-failed");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create project" },
      { status: 400 },
    );
  }
}
