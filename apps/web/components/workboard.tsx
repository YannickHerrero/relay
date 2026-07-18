"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Check, CircleAlert, GripVertical, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { taskPhaseLabels, taskPhases, type TaskPhase } from "@relay/domain";

import type { AdvanceDestination } from "./task-advance-action";

export type BoardTask = {
  id: string;
  projectName: string;
  type: string;
  priority: string;
  title: string;
  phase: TaskPhase;
  stage: string;
  runtimeStatus: string;
  lastActivityAt: string;
  currentPlanCommit: number;
  commits: number;
  testStatus?: string | undefined;
  advance?:
    | {
        destination: AdvanceDestination;
        phase: TaskPhase;
        label: string;
        description: string;
      }
    | undefined;
};

export function Workboard({ tasks, queryString }: { tasks: BoardTask[]; queryString: string }) {
  const router = useRouter();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string>();
  const [pendingMove, setPendingMove] = useState<BoardTask>();
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string>();
  const activeTask = tasks.find((task) => task.id === activeId);

  function onDragStart(event: DragStartEvent) {
    setError(undefined);
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    const task = tasks.find((entry) => entry.id === String(event.active.id));
    setActiveId(undefined);
    if (!task || !event.over) return;
    if (!task.advance || event.over.id !== task.advance.phase) {
      setError("Tasks move one phase at a time after the current gate is ready.");
      return;
    }
    setPendingMove(task);
  }

  async function confirmMove() {
    if (!pendingMove?.advance) return;
    setMoving(true);
    setError(undefined);
    const response = await fetch(`/api/tasks/${pendingMove.id}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination: pendingMove.advance.destination }),
    });
    const result = (await response.json()) as { error?: string };
    setMoving(false);
    if (!response.ok) {
      setError(result.error ?? "Unable to move task");
      setPendingMove(undefined);
      return;
    }
    setPendingMove(undefined);
    router.refresh();
  }

  return (
    <>
      {error ? (
        <p className="relay-board-move-error" role="alert">
          <CircleAlert size={13} /> {error}
          <button type="button" onClick={() => setError(undefined)} aria-label="Dismiss">
            <X size={12} />
          </button>
        </p>
      ) : null}
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <section className="relay-board relay-board-six" aria-label="Relay task board">
          {taskPhases.map((phase) => (
            <BoardColumn
              activeDestination={activeTask?.advance?.phase}
              key={phase}
              phase={phase}
              tasks={tasks.filter((task) => task.phase === phase)}
              queryString={queryString}
            />
          ))}
        </section>
        <DragOverlay>
          {activeTask ? (
            <div className="surface relay-task-card relay-task-drag-overlay">
              <span className="kicker">{activeTask.projectName}</span>
              <h3>{activeTask.title}</h3>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {pendingMove?.advance ? (
        <div className="relay-inline-dialog" role="dialog" aria-modal="true">
          <div className="relay-confirm-card relay-phase-confirm">
            <header>
              <div>
                <p className="kicker">Move to {taskPhaseLabels[pendingMove.advance.phase]}</p>
                <h2>{pendingMove.advance.label}?</h2>
              </div>
              <button
                type="button"
                onClick={() => setPendingMove(undefined)}
                aria-label="Close confirmation"
              >
                <X size={16} />
              </button>
            </header>
            <strong>{pendingMove.title}</strong>
            <p>{pendingMove.advance.description}</p>
            <div className="relay-form-actions">
              <button
                type="button"
                className="button"
                onClick={() => setPendingMove(undefined)}
                disabled={moving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => void confirmMove()}
                disabled={moving}
              >
                {moving ? "Moving…" : pendingMove.advance.label}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function BoardColumn({
  phase,
  tasks,
  activeDestination,
  queryString,
}: {
  phase: TaskPhase;
  tasks: BoardTask[];
  activeDestination?: TaskPhase | undefined;
  queryString: string;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: phase });
  const valid = activeDestination === phase;
  return (
    <section
      className={`relay-column ${isOver ? (valid ? "drop-valid" : "drop-invalid") : ""}`}
      ref={setNodeRef}
      aria-labelledby={`column-${phase}`}
    >
      <header>
        <h2 id={`column-${phase}`}>{taskPhaseLabels[phase]}</h2>
        <span>{String(tasks.length).padStart(2, "0")}</span>
      </header>
      <div className="relay-column-cards">
        {tasks.map((task) => (
          <DraggableTaskCard key={task.id} task={task} queryString={queryString} />
        ))}
        {!tasks.length ? (
          <div className="relay-column-empty">
            {isOver && valid ? "Drop to advance" : "No tasks"}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DraggableTaskCard({ task, queryString }: { task: BoardTask; queryString: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !task.advance,
  });
  const params = new URLSearchParams(queryString);
  params.set("task", task.id);
  params.set("phase", task.phase);
  const href = `/board?${params.toString()}`;
  return (
    <article
      className={`surface relay-task-card ${task.advance ? "is-draggable" : ""} ${isDragging ? "is-dragging" : ""}`}
      ref={setNodeRef}
      style={
        transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
      }
    >
      <Link href={href} className="relay-task-card-link" scroll={false}>
        <div className="relay-card-project">
          <span>{task.projectName}</span>
          <span>{task.type}</span>
        </div>
        <h3>{task.title}</h3>
        <div className="relay-card-badges">
          <span className={`relay-priority priority-${task.priority}`}>{task.priority}</span>
          {task.runtimeStatus === "blocked" || task.runtimeStatus === "failed" ? (
            <span className="relay-blocked">{task.runtimeStatus}</span>
          ) : null}
          {task.advance?.destination === "review" ? (
            <span className="relay-ready-badge">
              <Check size={10} /> Ready for review
            </span>
          ) : null}
        </div>
        <div className="relay-card-runtime">
          <span className={`relay-runtime runtime-${task.runtimeStatus}`}>
            <i /> {runtimeLabel(task.runtimeStatus, task.stage)}
          </span>
          <time dateTime={task.lastActivityAt}>{relativeTime(task.lastActivityAt)}</time>
        </div>
        {task.phase === "plan" || task.phase === "build" || task.stage === "deploying" ? (
          <div className="relay-progress">
            <i style={{ width: `${progress(task)}%` }} />
          </div>
        ) : null}
        <div className="relay-card-footer">
          <span>{task.commits} commits</span>
          <span>{testLabel(task.testStatus)}</span>
        </div>
      </Link>
      <button
        type="button"
        className="relay-card-drag-handle"
        suppressHydrationWarning
        aria-label={
          task.advance
            ? `Move ${task.title} to ${taskPhaseLabels[task.advance.phase]}`
            : `${task.title} is not ready to move`
        }
        disabled={!task.advance}
        title={
          task.advance
            ? `Move to ${taskPhaseLabels[task.advance.phase]}`
            : "Complete the current gate before moving"
        }
        {...listeners}
        {...attributes}
      >
        <GripVertical size={14} />
      </button>
    </article>
  );
}

function runtimeLabel(status: string, stage: string): string {
  if (stage === "ready_to_deploy") return "ready to deploy";
  return status.replaceAll("_", " ");
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000));
  if (seconds < 60) return "now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function testLabel(status?: string): string {
  if (!status) return "— tests";
  return status === "passed"
    ? "tests passing"
    : status === "failed"
      ? "tests failed"
      : "tests running";
}

function progress(task: BoardTask): number {
  if (task.phase === "plan") return task.runtimeStatus === "agent_running" ? 35 : 100;
  if (task.stage === "deploying") return 65;
  return Math.min(95, 15 + task.currentPlanCommit * 18);
}
