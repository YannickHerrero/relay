import { ArrowRight, Check, Folder, FolderGit2, GitBranch, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";

import { projects } from "@relay/db";
import { desc } from "drizzle-orm";

import { database } from "@/server/database";
import { scanProjectDirectories } from "@/server/project-directory";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const rows = database().db.select().from(projects).orderBy(desc(projects.updatedAt)).all();
  const registeredPaths = new Map(rows.map((project) => [project.repositoryPath, project.id]));
  const discovery = await scanProjectDirectories(registeredPaths);
  const errorCode = (await searchParams).error;

  return (
    <div className="relay-page">
      <header className="relay-page-head">
        <div>
          <p className="kicker">Repositories</p>
          <h1>Projects</h1>
          <p>Trusted local repositories, commands, and delivery recipes.</p>
        </div>
        <Link className="button button-primary" href="/projects/new">
          <Plus size={14} /> Create project
        </Link>
      </header>

      {errorCode === "register-failed" ? (
        <p className="relay-form-error" role="alert">
          Unable to register that repository. Confirm it has a valid default branch and try again.
        </p>
      ) : null}

      <section className="relay-project-section">
        <div className="relay-section-head">
          <div>
            <p className="kicker">Relay access</p>
            <h2>Registered projects</h2>
          </div>
          <span className="relay-count">{rows.length}</span>
        </div>
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
          <div className="surface relay-empty-state relay-empty-state-compact">
            <FolderGit2 size={22} />
            <div>
              <h2>No registered projects</h2>
              <p>Choose a discovered Git repository below or create a new one.</p>
            </div>
          </div>
        )}
      </section>

      <section className="relay-project-section">
        <div className="relay-section-head relay-discovery-head">
          <div>
            <p className="kicker">Projects directory</p>
            <h2>Discovered folders</h2>
            <p className="mono relay-project-root">{discovery.root}</p>
          </div>
          <div className="relay-section-actions">
            <span className="relay-count">{discovery.projects.length}</span>
            <Link className="button button-small" href="/projects">
              <RefreshCw size={13} /> Rescan
            </Link>
          </div>
        </div>

        {discovery.projects.length ? (
          <div className="relay-discovery-grid">
            {discovery.projects.map((project) => (
              <article className="surface relay-discovery-card" key={project.repositoryPath}>
                <div className="relay-discovery-main">
                  <div className="relay-project-icon">
                    {project.isGitRepository ? <FolderGit2 size={17} /> : <Folder size={17} />}
                  </div>
                  <div className="relay-discovery-copy">
                    <h3>{project.directoryName}</h3>
                    <p className="mono">{project.repositoryPath}</p>
                  </div>
                </div>
                <div className="relay-discovery-meta">
                  <span className="relay-project-type">{project.projectType}</span>
                  {project.defaultBranch ? (
                    <span className="relay-branch">
                      <GitBranch size={12} /> {project.defaultBranch}
                    </span>
                  ) : (
                    <span className="relay-muted-status">Not a Git repository</span>
                  )}
                </div>
                <div className="relay-discovery-action">
                  {project.registeredProjectId ? (
                    <Link
                      className="button button-small"
                      href={`/projects/${project.registeredProjectId}`}
                    >
                      <Check size={13} /> Registered
                    </Link>
                  ) : project.isGitRepository && project.defaultBranch ? (
                    <form action="/api/projects" method="post">
                      <input type="hidden" name="name" value={project.directoryName} />
                      <input type="hidden" name="directoryName" value={project.directoryName} />
                      <input type="hidden" name="projectType" value={project.projectType} />
                      <input type="hidden" name="defaultBranch" value={project.defaultBranch} />
                      <button className="button button-primary button-small">Register</button>
                    </form>
                  ) : (
                    <span className="relay-muted-status">Git required</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <section className="surface relay-empty-state">
            <Folder size={24} />
            <h2>No folders found</h2>
            <p>Create a project and Relay will add its folder under this directory.</p>
          </section>
        )}
      </section>
    </div>
  );
}
