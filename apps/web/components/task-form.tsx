"use client";

import { ArrowLeft, Paperclip, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type ProjectOption = { id: string; name: string; defaultBranch: string };

export function TaskForm({ projects }: { projects: ProjectOption[] }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const selectedProject = projects.find((project) => project.id === projectId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const response = await fetch("/api/tasks", {
      method: "POST",
      body: new FormData(event.currentTarget),
    });
    const result = (await response.json()) as { id?: string; error?: string };
    setPending(false);
    if (!response.ok || !result.id) {
      setError(result.error ?? "Unable to create task");
      return;
    }
    router.push(`/tasks/${result.id}?tab=conversation`);
    router.refresh();
  }

  return (
    <div className="relay-form-page">
      <Link href="/board" className="relay-back">
        <ArrowLeft size={13} /> Board
      </Link>
      <header>
        <p className="kicker">Requirement refinement</p>
        <h1>Create a task</h1>
        <p>Start with the outcome you want. The product refiner will help make it precise.</p>
      </header>
      <form className="surface relay-form-card" onSubmit={submit}>
        <div className="relay-form-intro">
          <Sparkles size={18} />
          <div>
            <strong>Vague is acceptable here</strong>
            <p>
              Relay will not allow implementation until you approve a specification and technical
              plan.
            </p>
          </div>
        </div>
        <label>
          <span className="label">Title</span>
          <input
            className="field"
            name="title"
            required
            maxLength={160}
            placeholder="Make word definitions feel faster"
          />
        </label>
        <label>
          <span className="label">Initial request</span>
          <textarea
            className="field"
            name="initialRequest"
            required
            maxLength={50000}
            placeholder="Describe the problem, desired outcome, and anything the agent should preserve…"
          />
        </label>
        <div className="relay-form-grid">
          <label>
            <span className="label">Project</span>
            <select
              className="field"
              name="projectId"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Base branch</span>
            <input
              className="field mono"
              name="baseBranch"
              key={selectedProject?.defaultBranch}
              defaultValue={selectedProject?.defaultBranch}
              required
            />
          </label>
          <label>
            <span className="label">Task type</span>
            <select className="field" name="type" defaultValue="feature">
              <option value="feature">Feature</option>
              <option value="bug">Bug</option>
              <option value="refactor">Refactor</option>
              <option value="maintenance">Maintenance</option>
              <option value="investigation">Investigation</option>
            </select>
          </label>
          <label>
            <span className="label">Priority</span>
            <select className="field" name="priority" defaultValue="medium">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
        </div>
        <label className="relay-file-field">
          <span>
            <Paperclip size={14} /> Attach evidence
          </span>
          <input
            type="file"
            name="attachments"
            multiple
            accept="image/*,video/*,.txt,.log,.json,.md,.pdf"
          />
          <small>Images, video, logs, documents · 25 MB each</small>
        </label>
        <div className="relay-agent-choice">
          <span className="relay-status-dot" />
          <div>
            <strong>Codex</strong>
            <p>Product refiner · repository read-only</p>
          </div>
        </div>
        {error ? (
          <p className="relay-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="relay-form-actions">
          <Link className="button" href="/board">
            Cancel
          </Link>
          <button className="button button-primary" disabled={pending || !projects.length}>
            {pending ? "Creating…" : "Create and start refinement"}
          </button>
        </div>
      </form>
    </div>
  );
}
