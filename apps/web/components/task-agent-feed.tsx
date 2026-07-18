"use client";

import { Bot, Check, ChevronDown, CircleAlert, FileCode2, Terminal, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

export type AgentRunView = {
  id: string;
  role: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
};

export type AgentEventView = {
  id: number;
  runId: string;
  type: string;
  payload: unknown;
  createdAt: string;
};

export function TaskAgentFeed({
  taskId,
  phase,
  runs,
  initialEvents,
  working,
  afterTask,
}: {
  taskId: string;
  phase: string;
  runs: AgentRunView[];
  initialEvents: AgentEventView[];
  working: boolean;
  afterTask: number;
}) {
  const router = useRouter();
  const [events, setEvents] = useState(initialEvents);
  const [atLatest, setAtLatest] = useState(true);
  const [now, setNow] = useState(Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const phaseRunIds = useMemo(
    () => new Set(runs.filter((run) => phaseForRole(run.role) === phase).map((run) => run.id)),
    [phase, runs],
  );
  const visibleEvents = events.filter(
    (event) => phaseRunIds.has(event.runId) || (working && phaseRunIds.size === 0),
  );
  const activeRun = [...runs]
    .reverse()
    .find((run) => phaseForRole(run.role) === phase && run.status === "running");

  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);

  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [working]);

  useEffect(() => {
    const stream = new EventSource(
      `/api/tasks/${taskId}/events?afterTask=${afterTask}&afterAgent=${initialEvents.at(-1)?.id ?? 0}`,
    );
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    stream.addEventListener("agent", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as AgentEventView;
      setEvents((current) =>
        current.some((entry) => entry.id === event.id) ? current : [...current, event],
      );
    });
    stream.addEventListener("task", () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), 350);
    });
    return () => {
      clearTimeout(refreshTimer);
      stream.close();
    };
  }, [afterTask, router, taskId]);

  useEffect(() => {
    if (!atLatest) return;
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [atLatest, visibleEvents.length]);

  const entries = aggregateEvents(visibleEvents);
  return (
    <section className="relay-agent-feed" aria-live="polite">
      <header>
        <div>
          <Bot size={15} />
          <strong>{working ? agentStatusLabel(phase) : "Agent work log"}</strong>
          {working ? <span className="relay-working-pulse" /> : null}
        </div>
        {activeRun ? <time>{elapsed(activeRun.startedAt, now)}</time> : null}
      </header>
      <div
        className="relay-agent-feed-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const target = event.currentTarget;
          setAtLatest(target.scrollHeight - target.scrollTop - target.clientHeight < 72);
        }}
      >
        {entries.map((entry) => (
          <AgentFeedEntry entry={entry} key={entry.key} />
        ))}
        {!entries.length ? (
          <div className="relay-agent-feed-empty">
            <Zap size={15} />
            <p>{working ? "The agent is starting…" : "Agent progress will appear here."}</p>
          </div>
        ) : null}
      </div>
      {!atLatest ? (
        <button
          className="button relay-jump-latest"
          onClick={() => {
            setAtLatest(true);
            const element = scrollRef.current;
            if (element) element.scrollTop = element.scrollHeight;
          }}
        >
          <ChevronDown size={12} /> Jump to latest
        </button>
      ) : null}
    </section>
  );
}

type FeedEntry = {
  key: string;
  type: "progress" | "message" | "command" | "output" | "file" | "complete" | "error";
  text: string;
  time: string;
  failed?: boolean;
};

function AgentFeedEntry({ entry }: { entry: FeedEntry }) {
  const Icon =
    entry.type === "command" || entry.type === "output"
      ? Terminal
      : entry.type === "file"
        ? FileCode2
        : entry.type === "error"
          ? CircleAlert
          : entry.type === "complete"
            ? Check
            : Bot;
  return (
    <article className={`relay-agent-entry agent-entry-${entry.type}`}>
      <Icon size={13} />
      <div>
        <time>
          {new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </time>
        {entry.type === "output" ? <pre>{entry.text}</pre> : <p>{entry.text}</p>}
      </div>
    </article>
  );
}

function aggregateEvents(events: AgentEventView[]): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const event of events) {
    const payload = asRecord(event.payload);
    const text = String(payload.text ?? payload.chunk ?? payload.command ?? payload.path ?? "");
    if (event.type === "message.delta" || event.type === "progress") {
      const type = event.type === "progress" ? "progress" : "message";
      const previous = entries.at(-1);
      if (previous?.type === type) previous.text += text;
      else entries.push({ key: String(event.id), type, text, time: event.createdAt });
    } else if (event.type === "command.started") {
      entries.push({ key: String(event.id), type: "command", text, time: event.createdAt });
    } else if (event.type === "command.output") {
      const previous = entries.at(-1);
      if (previous?.type === "output") previous.text = `${previous.text}${text}`.slice(-8_000);
      else entries.push({ key: String(event.id), type: "output", text, time: event.createdAt });
    } else if (event.type === "command.completed") {
      const exitCode = payload.exitCode;
      entries.push({
        key: String(event.id),
        type: exitCode === 0 ? "complete" : "error",
        text: `${String(payload.command ?? "Command")} ${exitCode === 0 ? "completed" : `failed (${String(exitCode)})`}`,
        time: event.createdAt,
      });
    } else if (event.type === "file.changed") {
      entries.push({ key: String(event.id), type: "file", text, time: event.createdAt });
    } else if (event.type === "artifact") {
      entries.push({ key: String(event.id), type: "file", text, time: event.createdAt });
    } else if (event.type === "error") {
      entries.push({
        key: String(event.id),
        type: "error",
        text: String(payload.message ?? "Agent failed"),
        time: event.createdAt,
      });
    } else if (event.type === "turn.completed") {
      entries.push({
        key: String(event.id),
        type: "complete",
        text: "Agent turn completed",
        time: event.createdAt,
      });
    }
  }
  return entries.filter((entry) => {
    if (!entry.text.trim()) return false;
    if (entry.type !== "message") return true;
    return !entry.text.includes("<relay-output>");
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function phaseForRole(role: string): string {
  if (role === "product-refiner") return "refine";
  if (role === "technical-planner") return "plan";
  if (role === "implementer") return "build";
  if (role === "deployment-diagnostician") return "deploy";
  return "review";
}

function agentStatusLabel(phase: string): string {
  return (
    (
      {
        refine: "Agent is refining the request",
        plan: "Agent is preparing the plan",
        build: "Agent is implementing and validating",
        review: "Agent is addressing review feedback",
        deploy: "Agent is diagnosing deployment evidence",
      } as Record<string, string>
    )[phase] ?? "Agent is working"
  );
}

function elapsed(startedAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}
