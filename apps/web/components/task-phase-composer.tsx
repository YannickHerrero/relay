"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function TaskPhaseComposer({
  taskId,
  phase,
  disabled,
}: {
  taskId: string;
  phase: "refine" | "plan" | "build" | "review";
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [instructionKind, setInstructionKind] = useState<"minor_correction" | "scope_change">(
    "minor_correction",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const content = String(new FormData(form).get("content") ?? "").trim();
    if (!content) return;
    if (phase === "review" && !window.confirm("Request these changes and return to Build?")) return;
    setPending(true);
    setError(undefined);
    try {
      await sendPhaseMessage(taskId, phase, content, instructionKind);
      form.reset();
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to send message");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="relay-phase-composer" onSubmit={submit}>
      <textarea
        name="content"
        rows={2}
        placeholder={placeholderForPhase(phase)}
        disabled={disabled || pending}
        required
      />
      <footer>
        <div>
          {phase === "build" ? (
            <select
              aria-label="Instruction type"
              value={instructionKind}
              onChange={(event) =>
                setInstructionKind(event.target.value as "minor_correction" | "scope_change")
              }
              disabled={disabled || pending}
            >
              <option value="minor_correction">Implementation instruction</option>
              <option value="scope_change">Scope change</option>
            </select>
          ) : (
            <span>{composerHint(phase)}</span>
          )}
          {error ? <small role="alert">{error}</small> : null}
        </div>
        <button className="button button-primary" disabled={disabled || pending}>
          <Send size={13} /> {pending ? "Sending…" : actionForPhase(phase)}
        </button>
      </footer>
    </form>
  );
}

async function sendPhaseMessage(
  taskId: string,
  phase: "refine" | "plan" | "build" | "review",
  content: string,
  instructionKind: "minor_correction" | "scope_change",
): Promise<void> {
  if (phase === "refine") {
    await post(`/api/tasks/${taskId}/messages`, { content });
    return;
  }
  if (phase === "plan") {
    await post(`/api/tasks/${taskId}/plan/comments`, { targetType: "global", content });
    await post(`/api/tasks/${taskId}/plan/revise`, {});
    return;
  }
  if (phase === "build") {
    await post(`/api/tasks/${taskId}/instructions`, {
      content,
      classification: instructionKind,
    });
    return;
  }
  await post(`/api/tasks/${taskId}/review/changes`, {
    comments: [{ targetType: "global", content }],
  });
}

async function post(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Action failed");
}

function placeholderForPhase(phase: string): string {
  return (
    {
      refine: "Answer a question or refine what Relay should build…",
      plan: "Ask for a plan change or clarify an implementation constraint…",
      build: "Give the active implementation agent an instruction…",
      review: "Describe the changes required before deployment…",
    } as Record<string, string>
  )[phase]!;
}

function composerHint(phase: string): string {
  return (
    {
      refine: "Replies continue the requirement conversation",
      plan: "Sending requests a new plan revision",
      review: "Sending returns this task to Build",
    } as Record<string, string>
  )[phase]!;
}

function actionForPhase(phase: string): string {
  return phase === "review" ? "Request changes" : "Send";
}
