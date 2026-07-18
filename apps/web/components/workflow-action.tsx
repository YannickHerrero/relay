"use client";

import { ArrowRight, Check, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function WorkflowAction({
  endpoint,
  label,
  tone = "primary",
  confirm,
  redirectTab,
  icon = "check",
}: {
  endpoint: string;
  label: string;
  tone?: "primary" | "default" | "accent";
  confirm?: string;
  redirectTab?: string;
  icon?: "check" | "return" | "next";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setPending(true);
    setError(undefined);
    const response = await fetch(endpoint, { method: "POST" });
    const result = (await response.json()) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(result.error ?? "Action failed");
      return;
    }
    if (redirectTab) router.replace(`${window.location.pathname}?tab=${redirectTab}`);
    router.refresh();
  }
  const Icon = icon === "return" ? RotateCcw : icon === "next" ? ArrowRight : Check;
  return (
    <div className="relay-action-wrap">
      <button
        className={`button ${tone === "primary" ? "button-primary" : tone === "accent" ? "button-accent" : ""}`}
        onClick={run}
        disabled={pending}
      >
        <Icon size={13} /> {pending ? "Working…" : label}
      </button>
      {error ? <small role="alert">{error}</small> : null}
    </div>
  );
}
