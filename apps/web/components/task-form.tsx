"use client";

import { ArrowLeft, FolderGit2, Paperclip, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type ProjectOption = { id: string; name: string; defaultBranch: string };

export function TaskForm({
  projects,
  creationKey,
  initialProjectId,
  initialError,
}: {
  projects: ProjectOption[];
  creationKey: string;
  initialProjectId: string;
  initialError?: string | undefined;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { accept: "application/json" },
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
    <div className="relay-task-create-page">
      <Link href="/board" className="relay-back">
        <ArrowLeft size={13} /> Board
      </Link>
      <header>
        <p className="kicker">New task</p>
        <h1>What should Relay work on?</h1>
      </header>
      <form
        action="/api/tasks"
        method="post"
        encType="multipart/form-data"
        className="surface relay-task-composer"
        onSubmit={submit}
      >
        <input type="hidden" name="creationKey" value={creationKey} />
        <label className="sr-only" htmlFor="task-request">
          Task request
        </label>
        <textarea
          className="relay-task-request"
          id="task-request"
          name="request"
          required
          maxLength={50000}
          rows={9}
          autoFocus
          placeholder="Describe what you want to build, fix, investigate, or improve…"
        />
        <div className="relay-task-composer-bar">
          <label className="relay-task-project-picker">
            <FolderGit2 size={14} />
            <span className="sr-only">Project</span>
            <select name="projectId" defaultValue={initialProjectId} required>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="relay-task-attachments">
            <Paperclip size={14} />
            <span>Add files</span>
            <input
              type="file"
              name="attachments"
              multiple
              accept="image/*,video/*,.txt,.log,.json,.md,.pdf"
            />
          </label>
          <button className="button button-primary relay-task-submit" disabled={pending}>
            <Send size={13} /> {pending ? "Starting…" : "Start task"}
          </button>
        </div>
        <p className="relay-task-file-help">Up to 10 files · 25 MB each</p>
        {error ? (
          <p className="relay-form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
