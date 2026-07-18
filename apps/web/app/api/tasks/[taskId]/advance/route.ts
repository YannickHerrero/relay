import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/server/auth";
import { assertMutationOrigin } from "@/server/security";
import { advanceTask } from "@/server/task-transitions";

const bodySchema = z.object({
  destination: z.enum(["planning", "implementation", "review", "ready_to_deploy"]),
});

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const { taskId } = await context.params;
    const { destination } = bodySchema.parse(await request.json());
    return NextResponse.json(advanceTask(taskId, destination));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to advance task" },
      { status: 400 },
    );
  }
}
