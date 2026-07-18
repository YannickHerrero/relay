import { cookies } from "next/headers";

const LAST_TASK_PROJECT_COOKIE = "relay_last_task_project";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function preferredTaskProjectId(
  availableProjectIds: readonly string[],
  requestedProjectId?: string,
): Promise<string> {
  if (requestedProjectId && availableProjectIds.includes(requestedProjectId)) {
    return requestedProjectId;
  }
  const rememberedProjectId = (await cookies()).get(LAST_TASK_PROJECT_COOKIE)?.value;
  if (rememberedProjectId && availableProjectIds.includes(rememberedProjectId)) {
    return rememberedProjectId;
  }
  return availableProjectIds[0] ?? "";
}

export async function rememberTaskProject(projectId: string): Promise<void> {
  (await cookies()).set(LAST_TASK_PROJECT_COOKIE, projectId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.RELAY_SECURE_COOKIES === "true",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}
