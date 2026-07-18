import { Archive, ArrowRight } from "lucide-react";
import Link from "next/link";

import { deployments, projects, taskCommits, tasks } from "@relay/db";
import { desc, eq } from "drizzle-orm";

import { database } from "@/server/database";

export const dynamic = "force-dynamic";

export default function ArchivePage() {
  const { db } = database();
  const rows = db
    .select({ task: tasks, project: projects })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.stage, "done"))
    .orderBy(desc(tasks.lastActivityAt))
    .all();
  const commits = db.select().from(taskCommits).all();
  const taskDeployments = db.select().from(deployments).all();
  return (
    <div className="relay-page">
      <header className="relay-page-head">
        <div>
          <p className="kicker">Complete product history</p>
          <h1>Archive</h1>
          <p>Completed tasks retain their requirements, plans, evidence, reviews, and releases.</p>
        </div>
      </header>
      {rows.length ? (
        <div className="relay-archive-grid">
          {rows.map(({ task, project }) => {
            const deployment = taskDeployments.find(
              (item) => item.taskId === task.id && item.status === "succeeded",
            );
            return (
              <Link className="surface" href={`/tasks/${task.id}`} key={task.id}>
                <div>
                  <span className="relay-runtime runtime-idle">
                    <i />
                    shipped
                  </span>
                  <time>{new Date(task.lastActivityAt).toLocaleDateString()}</time>
                </div>
                <h2>{task.title}</h2>
                <p>
                  {project.name} · {task.type}
                </p>
                <footer>
                  <span>
                    {commits.filter((commit) => commit.taskId === task.id).length} commits
                  </span>
                  <span>{deployment?.resultUrl ? "linked release" : "deployment recorded"}</span>
                  <ArrowRight size={13} />
                </footer>
              </Link>
            );
          })}
        </div>
      ) : (
        <section className="surface relay-empty-state">
          <Archive size={24} />
          <h2>No completed tasks</h2>
          <p>A successful explicit deployment moves its full history here.</p>
        </section>
      )}
    </div>
  );
}
