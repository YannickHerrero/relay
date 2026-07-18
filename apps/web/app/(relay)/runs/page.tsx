import { Bot, ExternalLink } from "lucide-react";
import Link from "next/link";

import { agentRuns, projects, tasks } from "@relay/db";
import { desc, eq } from "drizzle-orm";

import { database } from "@/server/database";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  const rows = database()
    .db.select({ run: agentRuns, task: tasks, project: projects })
    .from(agentRuns)
    .innerJoin(tasks, eq(tasks.id, agentRuns.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .orderBy(desc(agentRuns.startedAt))
    .limit(200)
    .all();
  return (
    <div className="relay-page">
      <header className="relay-page-head">
        <div>
          <p className="kicker">Agent sessions</p>
          <h1>Runs</h1>
          <p>Every phase uses a dedicated role, permission profile, and persisted event stream.</p>
        </div>
      </header>
      {rows.length ? (
        <div className="surface relay-table">
          <div className="relay-table-head">
            <span>Status</span>
            <span>Role</span>
            <span>Task</span>
            <span>Started</span>
            <span />
          </div>
          {rows.map(({ run, task, project }) => (
            <div key={run.id}>
              <span
                className={`relay-runtime runtime-${run.status === "failed" ? "failed" : run.status === "running" ? "agent_running" : "idle"}`}
              >
                <i />
                {run.status}
              </span>
              <span className="mono">{run.role}</span>
              <span>
                <strong>{task.title}</strong>
                <small>{project.name}</small>
              </span>
              <time>{new Date(run.startedAt).toLocaleString()}</time>
              <Link href={`/tasks/${task.id}?tab=execution`} aria-label="Open run">
                <ExternalLink size={13} />
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <section className="surface relay-empty-state">
          <Bot size={24} />
          <h2>No agent runs yet</h2>
          <p>Start a task to create the first product-refiner session.</p>
        </section>
      )}
    </div>
  );
}
