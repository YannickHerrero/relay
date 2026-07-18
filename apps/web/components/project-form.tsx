"use client";

import { ArrowLeft, FolderPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function ProjectForm({
  projectsRoot,
  initialError,
}: {
  projectsRoot: string;
  initialError?: string | undefined;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/projects/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = (await response.json()) as { id?: string; error?: string };
    setPending(false);
    if (!response.ok || !result.id) {
      setError(result.error ?? "Unable to create project");
      return;
    }
    router.push(`/projects/${result.id}`);
    router.refresh();
  }

  return (
    <div className="relay-form-page">
      <Link href="/projects" className="relay-back">
        <ArrowLeft size={13} /> Projects
      </Link>
      <header>
        <p className="kicker">New repository</p>
        <h1>Create a project</h1>
        <p>
          Relay creates, initializes, and registers a Git repository under your projects folder.
        </p>
      </header>
      <form
        action="/api/projects/create"
        method="post"
        className="surface relay-form-card"
        onSubmit={submit}
      >
        <div className="relay-form-intro">
          <FolderPlus size={18} />
          <div>
            <strong>Projects directory</strong>
            <p className="mono">{projectsRoot}</p>
          </div>
        </div>
        <label>
          <span className="label">Project name</span>
          <input className="field" name="name" required maxLength={100} placeholder="My project" />
        </label>
        <label>
          <span className="label">Folder name</span>
          <input
            className="field mono"
            name="directoryName"
            required
            maxLength={100}
            pattern="[^./][^/]*"
            placeholder="my-project"
          />
          <small>One new folder directly inside the configured projects directory.</small>
        </label>
        <div className="relay-form-grid">
          <label>
            <span className="label">Project type</span>
            <select className="field" name="projectType" defaultValue="web">
              <option value="web">Web</option>
              <option value="ios">Native iOS</option>
              <option value="expo">Expo / React Native</option>
              <option value="rust">Rust</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            <span className="label">Default branch</span>
            <input className="field mono" name="defaultBranch" defaultValue="main" required />
          </label>
        </div>
        {error ? (
          <p className="relay-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="relay-form-actions">
          <Link className="button" href="/projects">
            Cancel
          </Link>
          <button className="button button-primary" disabled={pending}>
            {pending ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
