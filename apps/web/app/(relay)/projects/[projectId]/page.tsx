import { ArrowLeft, Check, GitBranch, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { projectConfigVersions, projects } from "@relay/db";
import type { ProjectConfig } from "@relay/domain";
import { desc, eq } from "drizzle-orm";

import { RefreshConfigButton } from "@/components/refresh-config-button";
import { database } from "@/server/database";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { db } = database();
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) notFound();
  const config = db
    .select()
    .from(projectConfigVersions)
    .where(eq(projectConfigVersions.projectId, projectId))
    .orderBy(desc(projectConfigVersions.version))
    .get();
  const content = config?.content as ProjectConfig | undefined;
  const commandEntries = content
    ? Object.entries(content.commands).filter((entry) => entry[1]?.length)
    : [];

  return (
    <div className="relay-page relay-narrow-page">
      <Link href="/projects" className="relay-back">
        <ArrowLeft size={13} /> Projects
      </Link>
      <header className="relay-page-head">
        <div>
          <p className="kicker">{project.projectType} project</p>
          <h1>{project.name}</h1>
          <p className="mono">{project.repositoryPath}</p>
        </div>
        <RefreshConfigButton projectId={project.id} />
      </header>
      <div className="relay-summary-grid">
        <section className="surface relay-summary-card">
          <GitBranch size={16} />
          <span>Default branch</span>
          <strong className="mono">{project.defaultBranch}</strong>
        </section>
        <section className="surface relay-summary-card">
          <ShieldCheck size={16} />
          <span>Configuration</span>
          <strong>{config ? `v${config.version} · ${config.source}` : "Not loaded"}</strong>
        </section>
      </div>
      <section className="surface relay-config-section">
        <div className="relay-section-head">
          <div>
            <p className="kicker">Command policy</p>
            <h2>Configured validation</h2>
          </div>
          {config ? (
            <span className="relay-good">
              <Check size={12} /> {config.hash.slice(0, 8)}
            </span>
          ) : null}
        </div>
        {commandEntries.length ? (
          <div className="relay-command-groups">
            {commandEntries.map(([group, commands]) => (
              <div key={group}>
                <h3>{group}</h3>
                {commands?.map((command) => (
                  <code key={command}>{command}</code>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="relay-muted-copy">
            No commands configured. Add <code>.relay/project.config.ts</code> to the repository.
          </p>
        )}
      </section>
      <section className="surface relay-config-section">
        <div className="relay-section-head">
          <div>
            <p className="kicker">Manual actions</p>
            <h2>Deployment recipes</h2>
          </div>
        </div>
        {content?.deploymentRecipes.length ? (
          <div className="relay-recipe-list">
            {content.deploymentRecipes.map((recipe) => (
              <div key={recipe.id}>
                <span className="relay-status-dot" />
                <div>
                  <strong>{recipe.label}</strong>
                  <p>{recipe.environment} · explicit confirmation</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="relay-muted-copy">
            No deployment recipes configured. Relay will never infer or run one automatically.
          </p>
        )}
      </section>
    </div>
  );
}
