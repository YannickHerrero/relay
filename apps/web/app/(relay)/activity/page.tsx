import { Activity, ArrowRight } from "lucide-react";
import Link from "next/link";

import { projects, taskEvents, tasks } from "@relay/db";
import { desc, eq } from "drizzle-orm";

import { database } from "@/server/database";

export const dynamic = "force-dynamic";

export default function ActivityPage() {
  const rows = database()
    .db.select({ event: taskEvents, task: tasks, project: projects })
    .from(taskEvents)
    .innerJoin(tasks, eq(tasks.id, taskEvents.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .orderBy(desc(taskEvents.id))
    .limit(200)
    .all();
  return (
    <div className="relay-page relay-narrow-page">
      <header className="relay-page-head">
        <div>
          <p className="kicker">Persistent events</p>
          <h1>Activity</h1>
          <p>Workflow gates, agent outcomes, tests, reviews, and delivery actions.</p>
        </div>
      </header>
      {rows.length ? (
        <div className="relay-global-feed">
          {rows.map(({ event, task, project }) => (
            <Link href={`/tasks/${task.id}?tab=history`} className="surface" key={event.id}>
              <i />
              <div>
                <strong>{event.type.replaceAll(".", " · ")}</strong>
                <p>{task.title}</p>
                <small>
                  {project.name} · {new Date(event.createdAt).toLocaleString()}
                </small>
              </div>
              <ArrowRight size={14} />
            </Link>
          ))}
        </div>
      ) : (
        <section className="surface relay-empty-state">
          <Activity size={24} />
          <h2>No activity yet</h2>
          <p>Important Relay events will appear as work moves through the board.</p>
        </section>
      )}
    </div>
  );
}
