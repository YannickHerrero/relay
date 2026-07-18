"use client";

import { useEffect, useState } from "react";

import type { RelayHealth } from "@/server/health";

export function HostStatus({
  compact = false,
  initialHealth,
}: {
  compact?: boolean;
  initialHealth?: RelayHealth;
}) {
  const [health, setHealth] = useState<RelayHealth | undefined>(initialHealth);
  useEffect(() => {
    async function load() {
      const response = await fetch("/api/health");
      if (response.ok) setHealth((await response.json()) as RelayHealth);
    }
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, []);
  const statusClass = health
    ? health.online
      ? health.agentReady === false
        ? "warning"
        : ""
      : "offline"
    : "checking";
  if (compact)
    return (
      <span className="relay-agent-state">
        <i className={statusClass} />{" "}
        {health
          ? health.online && health.agentReady === false
            ? "Codex login required"
            : `${health.activeAgents} agents active`
          : "Checking worker"}
      </span>
    );
  return (
    <>
      <span className={`relay-status-dot ${statusClass}`} />
      <strong>Relay host</strong>
      <small>
        {health
          ? health.online
            ? health.agentReady === false
              ? "Codex login required"
              : `online · ${health.queuedJobs} queued`
            : "worker offline"
          : "checking worker"}
      </small>
    </>
  );
}
