import { ArrowLeft, CircleAlert, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { projects, tasks } from "@relay/db";
import { eq } from "drizzle-orm";

import { database } from "@/server/database";

export const dynamic = "force-dynamic";

export default async function DeleteTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { taskId } = await params;
  const row = database()
    .db.select({ task: tasks, project: projects })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId))
    .get();
  if (!row) notFound();
  const active = row.task.runtimeStatus === "agent_running" || row.task.stage === "deploying";
  const error = (await searchParams).error;

  return (
    <div className="relay-form-page relay-delete-page">
      <Link href={`/tasks/${taskId}`} className="relay-back">
        <ArrowLeft size={13} /> Task
      </Link>
      <header>
        <p className="kicker">Permanent action</p>
        <h1>Delete task?</h1>
        <p>This removes Relay's task record and local evidence. It cannot be undone.</p>
      </header>
      <section className="surface relay-delete-card">
        <div className="relay-delete-summary">
          <Trash2 size={19} />
          <div>
            <strong>{row.task.title}</strong>
            <p>
              {row.project.name} · {row.task.stage.replaceAll("_", " ")} ·{" "}
              {row.task.runtimeStatus.replaceAll("_", " ")}
            </p>
          </div>
        </div>
        <ul>
          <li>Conversation, specifications, plans, runs, tests, and history will be deleted.</li>
          <li>Uploads, artifacts, and any Relay-managed worktree will be removed.</li>
          <li>The source repository and task branch will be preserved.</li>
        </ul>
        {active ? (
          <p className="relay-form-error">
            <CircleAlert size={14} /> Stop the active task or deployment before deleting it.
          </p>
        ) : (
          <form action={`/api/tasks/${taskId}/delete`} method="post">
            <label className="relay-delete-confirmation">
              <input type="checkbox" name="confirmation" value="delete" required />I understand this
              permanently deletes the task from Relay.
            </label>
            {error === "delete-failed" ? (
              <p className="relay-form-error" role="alert">
                Relay could not safely delete this task. Confirm no operation is active.
              </p>
            ) : null}
            <div className="relay-form-actions">
              <Link className="button" href={`/tasks/${taskId}`}>
                Cancel
              </Link>
              <button className="button button-danger">
                <Trash2 size={13} /> Delete task
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
