import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { assertMutationOrigin } from "@/server/security";
import { advanceTask } from "@/server/task-transitions";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const { taskId } = await context.params;
    const result = advanceTask(taskId, "implementation");
    return NextResponse.json({ planVersion: result.version });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to approve plan" },
      { status: 400 },
    );
  }
}
