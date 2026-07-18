import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { formRedirect } from "@/server/form-request";
import { assertMutationOrigin } from "@/server/security";
import { deleteTask } from "@/server/task-deletion";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const wantsJson = request.headers.get("accept")?.includes("application/json") ?? false;
  const { taskId } = await context.params;
  try {
    assertMutationOrigin(request);
    const form = await request.formData();
    if (form.get("confirmation") !== "delete") throw new Error("Deletion was not confirmed");
    await deleteTask(taskId);
    return wantsJson ? NextResponse.json({ ok: true }) : formRedirect("/board");
  } catch (error) {
    if (!wantsJson) return formRedirect(`/tasks/${taskId}/delete?error=delete-failed`);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete task" },
      { status: 400 },
    );
  }
}
