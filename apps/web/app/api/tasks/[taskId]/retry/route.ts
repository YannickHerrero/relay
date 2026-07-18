import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { formRedirect } from "@/server/form-request";
import { relayHealth } from "@/server/health";
import { assertMutationOrigin } from "@/server/security";
import { retryFailedTask } from "@/server/task-recovery";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const wantsJson = request.headers.get("accept")?.includes("application/json") ?? false;
  const { taskId } = await context.params;
  try {
    assertMutationOrigin(request);
    if ((await relayHealth()).agentReady === false) {
      throw new Error("Codex login is required before retrying this task");
    }
    const jobId = retryFailedTask(taskId);
    return wantsJson
      ? NextResponse.json({ ok: true, jobId })
      : formRedirect(`/tasks/${taskId}?tab=conversation`);
  } catch (error) {
    if (!wantsJson) return formRedirect(`/tasks/${taskId}?tab=overview&error=retry-failed`);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to retry task" },
      { status: 400 },
    );
  }
}
