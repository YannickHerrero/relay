import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { formRedirect } from "@/server/form-request";
import { relayHealth } from "@/server/health";
import { assertMutationOrigin } from "@/server/security";
import { rememberTaskProject } from "@/server/task-preferences";
import { createTaskFromRequest, taskRequestSchema } from "@/server/tasks";

export async function POST(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const wantsJson = request.headers.get("accept")?.includes("application/json") ?? false;
  try {
    assertMutationOrigin(request);
    if ((await relayHealth()).agentReady === false) throw new CodexLoginRequiredError();
    const form = await request.formData();
    const input = taskRequestSchema.parse({
      creationKey: form.get("creationKey"),
      projectId: form.get("projectId"),
      request: form.get("request"),
    });
    const files = form
      .getAll("attachments")
      .filter((item): item is File => item instanceof File && item.size > 0);
    const id = await createTaskFromRequest(input, files);
    await rememberTaskProject(input.projectId);
    return wantsJson
      ? NextResponse.json({ id }, { status: 201 })
      : formRedirect(`/board?task=${id}&phase=refine`);
  } catch (error) {
    if (!wantsJson) {
      return formRedirect(
        `/tasks/new?error=${error instanceof CodexLoginRequiredError ? "codex-login-required" : "create-failed"}`,
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create task" },
      { status: 400 },
    );
  }
}

class CodexLoginRequiredError extends Error {
  constructor() {
    super("Codex login is required before starting a task");
  }
}
