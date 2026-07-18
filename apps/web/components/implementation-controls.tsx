"use client";

import { Ban, FlaskConical, MessageSquarePlus, Pause, Play, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function ImplementationControls({ taskId, status }: { taskId: string; status: string }) {
  const router = useRouter();
  const [instructionOpen, setInstructionOpen] = useState(false);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();

  async function control(action: "stop" | "resume" | "rerun_tests" | "block") {
    const reason =
      action === "block" ? (window.prompt("Why is this task blocked?") ?? undefined) : undefined;
    if (action === "block" && reason === undefined) return;
    setPending(action);
    setError(undefined);
    const response = await fetch(`/api/tasks/${taskId}/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    const result = (await response.json()) as { error?: string };
    setPending(undefined);
    if (!response.ok) {
      setError(result.error ?? "Control failed");
      return;
    }
    router.refresh();
  }

  async function instruct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending("instruction");
    setError(undefined);
    const response = await fetch(`/api/tasks/${taskId}/instructions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: data.get("content"),
        classification: data.get("classification"),
      }),
    });
    const result = (await response.json()) as { error?: string };
    setPending(undefined);
    if (!response.ok) {
      setError(result.error ?? "Instruction failed");
      return;
    }
    setInstructionOpen(false);
    form.reset();
    router.refresh();
  }

  const resumable = ["stopped", "blocked", "failed"].includes(status);
  return (
    <div className="relay-implementation-controls">
      <div className="relay-control-buttons">
        {resumable ? (
          <button
            className="button button-primary"
            onClick={() => control("resume")}
            disabled={!!pending}
          >
            <Play size={12} /> Resume agent
          </button>
        ) : (
          <button className="button" onClick={() => control("stop")} disabled={!!pending}>
            <Pause size={12} /> Stop agent
          </button>
        )}
        <button className="button" onClick={() => setInstructionOpen(true)}>
          <MessageSquarePlus size={12} /> Instruction
        </button>
        <button className="button" onClick={() => control("rerun_tests")} disabled={!!pending}>
          <FlaskConical size={12} /> Rerun tests
        </button>
        <button className="button" onClick={() => control("block")}>
          <Ban size={12} /> Block
        </button>
      </div>
      {error ? <small role="alert">{error}</small> : null}
      {instructionOpen ? (
        <div
          className="relay-inline-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="instruction-title"
        >
          <form onSubmit={instruct}>
            <header>
              <div>
                <p className="kicker">Scope protection</p>
                <h2 id="instruction-title">Send an instruction</h2>
              </div>
              <button type="button" onClick={() => setInstructionOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </header>
            <textarea
              className="field"
              name="content"
              required
              placeholder="Describe the correction or changed requirement…"
            />
            <fieldset>
              <legend className="label">How should Relay treat this?</legend>
              <label>
                <input type="radio" name="classification" value="minor_correction" defaultChecked />
                <span>
                  <strong>Minor correction</strong>
                  <small>
                    Interrupt safely, then resume the approved commit with this context.
                  </small>
                </span>
              </label>
              <label>
                <input type="radio" name="classification" value="scope_change" />
                <span>
                  <strong>Requirement revision</strong>
                  <small>
                    Block implementation and record that renewed product approval is required.
                  </small>
                </span>
              </label>
            </fieldset>
            <div className="relay-form-actions">
              <button type="button" className="button" onClick={() => setInstructionOpen(false)}>
                Cancel
              </button>
              <button className="button button-primary" disabled={pending === "instruction"}>
                {pending === "instruction" ? "Sending…" : "Send instruction"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
