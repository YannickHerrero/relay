import { ExternalLink, Rocket } from "lucide-react";
import Link from "next/link";

import { deployments, projects, tasks } from "@relay/db";
import { desc, eq } from "drizzle-orm";

import { database } from "@/server/database";

export const dynamic = "force-dynamic";

export default function DeploymentsPage() {
  const rows = database()
    .db.select({ deployment: deployments, task: tasks, project: projects })
    .from(deployments)
    .innerJoin(tasks, eq(tasks.id, deployments.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .orderBy(desc(deployments.createdAt))
    .limit(200)
    .all();
  return (
    <div className="relay-page">
      <header className="relay-page-head">
        <div>
          <p className="kicker">Protected actions</p>
          <h1>Deployments</h1>
          <p>Every attempt is tied to an exact reviewed SHA and an explicit owner confirmation.</p>
        </div>
      </header>
      {rows.length ? (
        <div className="surface relay-table">
          <div className="relay-table-head">
            <span>Status</span>
            <span>Recipe</span>
            <span>Task</span>
            <span>SHA</span>
            <span />
          </div>
          {rows.map(({ deployment, task, project }) => (
            <div key={deployment.id}>
              <span
                className={`relay-runtime runtime-${deployment.status === "failed" ? "failed" : deployment.status === "running" ? "agent_running" : "idle"}`}
              >
                <i />
                {deployment.status}
              </span>
              <span className="mono">{deployment.recipeId}</span>
              <span>
                <strong>{task.title}</strong>
                <small>{project.name}</small>
              </span>
              <code>{deployment.commitSha.slice(0, 10)}</code>
              <Link href={`/tasks/${task.id}?tab=deployment`} aria-label="Open deployment">
                <ExternalLink size={13} />
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <section className="surface relay-empty-state">
          <Rocket size={24} />
          <h2>No deployments yet</h2>
          <p>Approved implementations and configured delivery recipes will appear here.</p>
        </section>
      )}
    </div>
  );
}
