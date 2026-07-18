"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function ConversationComposer({ taskId, disabled }: { taskId: string; disabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const content = String(new FormData(form).get("content") ?? "").trim();
    if (!content) return;
    setPending(true);
    setError(undefined);
    const response = await fetch(`/api/tasks/${taskId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const result = (await response.json()) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(result.error ?? "Unable to send message");
      return;
    }
    form.reset();
    router.refresh();
  }
  return (
    <form className="relay-composer" onSubmit={submit}>
      <textarea
        name="content"
        rows={2}
        placeholder={
          disabled
            ? "Requirement is no longer editable"
            : "Reply, resolve a question, or ask for a reformulation…"
        }
        disabled={disabled || pending}
        required
      />
      <div>
        <span>
          {error ? <b role="alert">{error}</b> : "Repository access is read-only in refinement"}
        </span>
        <button className="button button-primary" disabled={disabled || pending}>
          {pending ? (
            "Sending…"
          ) : (
            <>
              <Send size={13} /> Send
            </>
          )}
        </button>
      </div>
    </form>
  );
}
