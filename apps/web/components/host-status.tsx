"use client";

import { useEffect, useState } from "react";

type Health = {
  online: boolean;
  workerId: string | null;
  activeAgents: number;
  queuedJobs: number;
};

export function HostStatus({ compact = false }: { compact?: boolean }) {
  const [health, setHealth] = useState<Health>();
  useEffect(() => {
    async function load() {
      const response = await fetch("/api/health");
      if (response.ok) setHealth((await response.json()) as Health);
    }
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, []);
  if (compact)
    return (
      <span className="relay-agent-state">
        <i className={health?.online ? "" : "offline"} />{" "}
        {health ? `${health.activeAgents} agents active` : "Checking worker"}
      </span>
    );
  return (
    <>
      <span className={`relay-status-dot ${health?.online ? "" : "offline"}`} />
      <strong>Relay host</strong>
      <small>{health?.online ? `online · ${health.queuedJobs} queued` : "worker offline"}</small>
    </>
  );
}
