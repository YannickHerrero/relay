"use client";

import { MessageSquare, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function PlanFeedback({
  taskId,
  commits,
}: {
  taskId: string;
  commits: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = event.currentTarget;
    const data = new FormData(form);
    const target = String(data.get("target"));
    const [targetType, targetId] = target.split(":", 2);
    const comment = await fetch(`/api/tasks/${taskId}/plan/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetType,
        targetId: targetId || undefined,
        content: data.get("content"),
      }),
    });
    const result = (await comment.json()) as { error?: string };
    if (!comment.ok) {
      setPending(false);
      setError(result.error ?? "Unable to add comment");
      return;
    }
    const revision = await fetch(`/api/tasks/${taskId}/plan/revise`, { method: "POST" });
    const revisionResult = (await revision.json()) as { error?: string };
    setPending(false);
    if (!revision.ok) {
      setError(revisionResult.error ?? "Unable to request revision");
      return;
    }
    form.reset();
    router.refresh();
  }
  return (
    <form className="relay-plan-feedback" onSubmit={submit}>
      <div>
        <MessageSquare size={14} />
        <strong>Request a plan revision</strong>
      </div>
      <select className="field" name="target">
        <option value="global">Whole plan</option>
        {commits.map((commit) => (
          <option key={commit.id} value={`commit:${commit.id}`}>
            Commit · {commit.title}
          </option>
        ))}
      </select>
      <textarea
        className="field"
        name="content"
        required
        placeholder="Explain exactly what should change in the plan…"
      />
      <div>
        {error ? (
          <span role="alert">{error}</span>
        ) : (
          <small>The current plan remains immutable in history.</small>
        )}
        <button className="button" disabled={pending}>
          <RefreshCw size={12} /> {pending ? "Requesting…" : "Add comment and revise"}
        </button>
      </div>
    </form>
  );
}
