import { projects } from "@relay/db";
import { asc } from "drizzle-orm";
import Link from "next/link";

import { TaskForm } from "@/components/task-form";
import { database } from "@/server/database";

export const dynamic = "force-dynamic";

export default function NewTaskPage() {
  const rows = database()
    .db.select({ id: projects.id, name: projects.name, defaultBranch: projects.defaultBranch })
    .from(projects)
    .orderBy(asc(projects.name))
    .all();
  if (!rows.length)
    return (
      <section className="relay-empty-page">
        <p className="kicker">Project required</p>
        <h1>Register a repository first.</h1>
        <p>Tasks need a trusted repository and base branch.</p>
        <Link className="button button-primary" href="/projects/new">
          Register project
        </Link>
      </section>
    );
  return <TaskForm projects={rows} />;
}
