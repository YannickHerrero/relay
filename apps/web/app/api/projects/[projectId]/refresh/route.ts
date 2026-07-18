import { NextResponse } from "next/server";

import { currentUser } from "@/server/auth";
import { refreshProjectConfig } from "@/server/projects";
import { assertMutationOrigin } from "@/server/security";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertMutationOrigin(request);
    const { projectId } = await context.params;
    const config = await refreshProjectConfig(projectId);
    return NextResponse.json({ config });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to refresh project" },
      { status: 400 },
    );
  }
}
