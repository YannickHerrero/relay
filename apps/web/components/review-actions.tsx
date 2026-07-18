"use client";

import { Check, MessageSquareWarning, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function ReviewActions({
  taskId,
  commits,
}: {
  taskId: string;
  commits: Array<{ sha: string; message: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function approve() {
    if (!window.confirm("Approve this exact implementation and make deployment actions available?"))
      return;
    setPending(true);
    setError(undefined);
    const response = await fetch(`/api/tasks/${taskId}/review/approve`, { method: "POST" });
    const result = (await response.json()) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(result.error ?? "Approval failed");
      return;
    }
    router.replace(`${window.location.pathname}?tab=deployment`);
    router.refresh();
  }
  async function requestChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const target = String(data.get("target"));
    const [targetType, targetId] = target.split(":", 2);
    setPending(true);
    setError(undefined);
    const response = await fetch(`/api/tasks/${taskId}/review/changes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        comments: [{ targetType, targetId: targetId || undefined, content: data.get("content") }],
      }),
    });
    const result = (await response.json()) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(result.error ?? "Unable to request changes");
      return;
    }
    setOpen(false);
    router.replace(`${window.location.pathname}?tab=execution`);
    router.refresh();
  }
  return (
    <section className="relay-review-gate">
      <div>
        <p className="kicker">Human review gate</p>
        <h2>Validate the delivery evidence</h2>
        <p>Approval unlocks delivery recipes but does not run any of them.</p>
      </div>
      <div>
        <button className="button" onClick={() => setOpen(true)}>
          <MessageSquareWarning size={13} /> Request changes
        </button>
        <button className="button button-primary" onClick={approve} disabled={pending}>
          <Check size={13} /> Approve implementation
        </button>
      </div>
      {error ? <small role="alert">{error}</small> : null}
      {open ? (
        <div className="relay-inline-dialog" role="dialog" aria-modal="true">
          <form onSubmit={requestChanges}>
            <header>
              <div>
                <p className="kicker">Review request</p>
                <h2>Request implementation changes</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </header>
            <select className="field" name="target">
              <option value="global">Whole implementation</option>
              {commits.map((commit) => (
                <option key={commit.sha} value={`commit:${commit.sha}`}>
                  Commit · {commit.message}
                </option>
              ))}
            </select>
            <textarea
              className="field"
              name="content"
              required
              placeholder="Describe the exact correction and expected evidence…"
            />
            <div className="relay-form-actions">
              <button type="button" className="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="button button-primary" disabled={pending}>
                Return to implementation
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
