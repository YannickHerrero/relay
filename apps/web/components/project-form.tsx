"use client";

import { ArrowLeft, FolderGit2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function ProjectForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = (await response.json()) as { id?: string; error?: string };
    setPending(false);
    if (!response.ok || !result.id) {
      setError(result.error ?? "Unable to register project");
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
        <p className="kicker">Repository access</p>
        <h1>Register a project</h1>
        <p>Relay validates the repository and snapshots its project configuration.</p>
      </header>
      <form className="surface relay-form-card" onSubmit={submit}>
        <div className="relay-form-intro">
          <FolderGit2 size={18} />
          <div>
            <strong>Local Git repository</strong>
            <p>Use an absolute path available to the macOS account running Relay.</p>
          </div>
        </div>
        <label>
          <span className="label">Project name</span>
          <input className="field" name="name" required maxLength={100} placeholder="Doku Reader" />
        </label>
        <label>
          <span className="label">Repository path</span>
          <input
            className="field mono"
            name="repositoryPath"
            required
            placeholder="/Users/agent/dev/doku"
          />
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
            {pending ? "Validating…" : "Register project"}
          </button>
        </div>
      </form>
    </div>
  );
}
