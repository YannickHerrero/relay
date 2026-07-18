"use client";

import { ArrowRight, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type AdvanceDestination = "planning" | "implementation" | "review" | "ready_to_deploy";

export function TaskAdvanceAction({
  taskId,
  destination,
  label,
  description,
  nextPhase,
}: {
  taskId: string;
  destination: AdvanceDestination;
  label: string;
  description: string;
  nextPhase: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function advance() {
    setPending(true);
    setError(undefined);
    const response = await fetch(`/api/tasks/${taskId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination }),
    });
    const result = (await response.json()) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(result.error ?? "Unable to advance task");
      return;
    }
    setConfirming(false);
    const url = new URL(window.location.href);
    url.searchParams.set("phase", nextPhase);
    router.replace(`${url.pathname}${url.search}`);
    router.refresh();
  }

  return (
    <div className="relay-advance-action">
      <button className="button button-primary" onClick={() => setConfirming(true)}>
        {label} <ArrowRight size={13} />
      </button>
      {error ? <small role="alert">{error}</small> : null}
      {confirming ? (
        <div className="relay-inline-dialog" role="dialog" aria-modal="true">
          <div className="relay-confirm-card relay-phase-confirm">
            <header>
              <div>
                <p className="kicker">Advance task</p>
                <h2>{label}?</h2>
              </div>
              <button onClick={() => setConfirming(false)} aria-label="Close confirmation">
                <X size={16} />
              </button>
            </header>
            <p>{description}</p>
            <div className="relay-form-actions">
              <button className="button" onClick={() => setConfirming(false)} disabled={pending}>
                Cancel
              </button>
              <button className="button button-primary" onClick={advance} disabled={pending}>
                {pending ? "Advancing…" : label}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
