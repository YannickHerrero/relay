import { projects } from "@relay/db";
import { asc } from "drizzle-orm";
import Link from "next/link";

import { TaskForm } from "@/components/task-form";
import { database } from "@/server/database";
import { preferredTaskProjectId } from "@/server/task-preferences";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewTaskPage({ searchParams }: { searchParams: SearchParams }) {
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
        <p>Tasks need a trusted repository before Relay can begin refinement.</p>
        <Link className="button button-primary" href="/projects">
          View projects
        </Link>
      </section>
    );

  const query = await searchParams;
  const requestedProjectId = typeof query.project === "string" ? query.project : undefined;
  const initialProjectId = await preferredTaskProjectId(
    rows.map((project) => project.id),
    requestedProjectId,
  );
  const initialError =
    query.error === "create-failed"
      ? "Unable to create the task. Check the request and files."
      : undefined;

  return (
    <TaskForm projects={rows} initialProjectId={initialProjectId} initialError={initialError} />
  );
}
