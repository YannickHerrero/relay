import { redirect } from "next/navigation";

import { tasks } from "@relay/db";
import { taskPhaseForStage, taskStageSchema, type TaskPhase } from "@relay/domain";
import { eq } from "drizzle-orm";

import { database } from "@/server/database";

export const dynamic = "force-dynamic";

export default async function TaskDetailRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { taskId } = await params;
  const task = database().db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  const requestedTab = (await searchParams).tab;
  const phase =
    oldTabPhase(requestedTab) ??
    (task ? taskPhaseForStage(taskStageSchema.parse(task.stage)) : "refine");
  redirect(`/board?task=${encodeURIComponent(taskId)}&phase=${phase}`);
}

function oldTabPhase(tab?: string): TaskPhase | undefined {
  if (["conversation", "specification"].includes(tab ?? "")) return "refine";
  if (tab === "plan") return "plan";
  if (["execution", "git", "tests"].includes(tab ?? "")) return "build";
  if (tab === "deployment") return "deploy";
  return undefined;
}
