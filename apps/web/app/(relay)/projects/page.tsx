import { ArrowRight, FolderGit2, Plus } from "lucide-react";
import Link from "next/link";

import { projects } from "@relay/db";
import { desc } from "drizzle-orm";

import { database } from "@/server/database";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const rows = database().db.select().from(projects).orderBy(desc(projects.updatedAt)).all();
  return (
    <div className="relay-page">
      <header className="relay-page-head">
        <div>
          <p className="kicker">Repositories</p>
          <h1>Projects</h1>
          <p>Trusted local repositories, commands, and delivery recipes.</p>
        </div>
        <Link className="button button-primary" href="/projects/new">
          <Plus size={14} /> Register project
        </Link>
      </header>
      {rows.length ? (
        <div className="relay-project-grid">
          {rows.map((project) => (
            <Link
              className="surface relay-project-card"
              href={`/projects/${project.id}`}
              key={project.id}
            >
              <div className="relay-project-icon">
                <FolderGit2 size={17} />
              </div>
              <div>
                <h2>{project.name}</h2>
                <p className="mono">{project.repositoryPath}</p>
              </div>
              <span className="relay-project-type">{project.projectType}</span>
              <div className="relay-project-meta">
                <span>
                  Base <b>{project.defaultBranch}</b>
                </span>
                <span>Updated {new Date(project.updatedAt).toLocaleDateString()}</span>
              </div>
              <ArrowRight className="relay-project-arrow" size={15} />
            </Link>
          ))}
        </div>
      ) : (
        <section className="surface relay-empty-state">
          <FolderGit2 size={24} />
          <h2>No projects yet</h2>
          <p>Register the first Git repository Relay may inspect and modify.</p>
          <Link className="button button-primary" href="/projects/new">
            Register a project
          </Link>
        </section>
      )}
    </div>
  );
}
