import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { createTask, taskInputSchema } from "@/server/tasks";
import { assertMutationOrigin } from "@/server/security";

export async function POST(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const form = await request.formData();
    const input = taskInputSchema.parse({
      projectId: form.get("projectId"),
      title: form.get("title"),
      initialRequest: form.get("initialRequest"),
      type: form.get("type"),
      priority: form.get("priority"),
      baseBranch: form.get("baseBranch"),
    });
    const files = form
      .getAll("attachments")
      .filter((item): item is File => item instanceof File && item.size > 0);
    const id = await createTask(input, files);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create task" },
      { status: 400 },
    );
  }
}
