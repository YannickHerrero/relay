"use client";

import {
  Check,
  CircleAlert,
  FileText,
  GitCommitHorizontal,
  Lock,
  Paperclip,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { taskPhaseForStage, taskPhaseLabels, taskPhases, type TaskPhase } from "@relay/domain";

import type { TaskWorkspace } from "@/server/task-workspace";

import { DeploymentActions } from "./deployment-actions";
import { ImplementationControls } from "./implementation-controls";
import { TaskAdvanceAction, type AdvanceDestination } from "./task-advance-action";
import { TaskAgentFeed } from "./task-agent-feed";
import { TaskPhaseComposer } from "./task-phase-composer";

export function TaskWorkspaceDialog({
  workspace,
  requestedPhase,
}: {
  workspace: TaskWorkspace;
  requestedPhase?: string | undefined;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const currentPhase = taskPhaseForStage(
    workspace.task.stage as Parameters<typeof taskPhaseForStage>[0],
  );
  const visited = useMemo(
    () => new Set<TaskPhase>([...workspace.phases, currentPhase]),
    [currentPhase, workspace.phases],
  );
  const phase =
    taskPhases.includes(requestedPhase as TaskPhase) && visited.has(requestedPhase as TaskPhase)
      ? (requestedPhase as TaskPhase)
      : currentPhase;
  const working = workspace.task.runtimeStatus === "agent_running";
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [actionError, setActionError] = useState<string>();

  function close() {
    const url = new URL(window.location.href);
    url.searchParams.delete("task");
    url.searchParams.delete("phase");
    router.replace(`${url.pathname}${url.search}`);
  }

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], textarea:not(:disabled), select:not(:disabled), input:not(:disabled)",
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, []);

  function selectPhase(nextPhase: TaskPhase) {
    if (!visited.has(nextPhase)) return;
    const url = new URL(window.location.href);
    url.searchParams.set("phase", nextPhase);
    router.replace(`${url.pathname}${url.search}`);
  }

  async function retry() {
    setActionError(undefined);
    const response = await fetch(`/api/tasks/${workspace.task.id}/retry`, {
      method: "POST",
      headers: { accept: "application/json" },
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) setActionError(result.error ?? "Unable to retry task");
    else router.refresh();
  }

  async function deleteTask() {
    setActionError(undefined);
    const form = new FormData();
    form.set("confirmation", "delete");
    const response = await fetch(`/api/tasks/${workspace.task.id}/delete`, {
      method: "POST",
      headers: { accept: "application/json" },
      body: form,
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) setActionError(result.error ?? "Unable to delete task");
    else close();
  }

  const canDelete = !working && workspace.task.stage !== "deploying";
  return (
    <div
      className="relay-task-dialog-layer"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        className="relay-task-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dialog-title"
      >
        <header className="relay-task-dialog-head">
          <div>
            <p className="kicker">
              {workspace.project.name} · {workspace.task.type} · {workspace.task.priority}
            </p>
            <h1 id="task-dialog-title">{workspace.task.title}</h1>
            <div className="relay-task-status">
              <span>{taskPhaseLabels[currentPhase]}</span>
              <span className={`relay-runtime runtime-${workspace.task.runtimeStatus}`}>
                <i /> {runtimeLabel(workspace.task.runtimeStatus, workspace.task.stage)}
              </span>
              <span className="mono">base {workspace.task.baseBranch}</span>
            </div>
          </div>
          <div className="relay-task-dialog-controls">
            {workspace.task.stage === "implementation" &&
            ["agent_running", "stopped", "blocked"].includes(workspace.task.runtimeStatus) ? (
              <ImplementationControls
                taskId={workspace.task.id}
                status={workspace.task.runtimeStatus}
              />
            ) : null}
            {workspace.task.runtimeStatus === "failed" ? (
              <button type="button" className="button button-primary" onClick={() => void retry()}>
                <RotateCcw size={13} /> Retry task
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                className="button button-danger"
                onClick={() => setDeleteConfirming(true)}
              >
                <Trash2 size={13} /> Delete
              </button>
            ) : null}
            <button
              type="button"
              className="button relay-dialog-close"
              onClick={close}
              ref={closeRef}
              aria-label="Close task"
            >
              <X size={16} />
            </button>
          </div>
        </header>
        {workspace.task.blockedReason || actionError ? (
          <div className="relay-dialog-alert" role="alert">
            <CircleAlert size={14} /> {actionError ?? workspace.task.blockedReason}
          </div>
        ) : null}
        <nav className="relay-phase-tabs" aria-label="Task phases">
          {taskPhases.map((item) => {
            const enabled = visited.has(item);
            const completed =
              enabled && taskPhases.indexOf(item) < taskPhases.indexOf(currentPhase);
            return (
              <button
                key={item}
                className={`${phase === item ? "active" : ""} ${completed ? "completed" : ""}`}
                onClick={() => selectPhase(item)}
                disabled={!enabled}
                title={enabled ? taskPhaseLabels[item] : `${taskPhaseLabels[item]} has not started`}
              >
                {completed ? <Check size={12} /> : enabled ? null : <Lock size={11} />}
                {taskPhaseLabels[item]}
              </button>
            );
          })}
        </nav>
        <div className="relay-task-dialog-layout">
          <main className="relay-phase-workspace">
            <PhaseConversation workspace={workspace} phase={phase} currentPhase={currentPhase} />
          </main>
          <ActivityRail workspace={workspace} working={working} currentPhase={currentPhase} />
        </div>
        {deleteConfirming ? (
          <div className="relay-inline-dialog" role="dialog" aria-modal="true">
            <div className="relay-confirm-card relay-delete-confirm">
              <header>
                <div>
                  <p className="kicker">Permanent action</p>
                  <h2>Delete this task?</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteConfirming(false)}
                  aria-label="Close confirmation"
                >
                  <X size={16} />
                </button>
              </header>
              <p>
                Conversation, evidence, uploads, artifacts, and the Relay worktree will be removed.
              </p>
              <p>The source repository and task branch will be preserved.</p>
              <div className="relay-form-actions">
                <button type="button" className="button" onClick={() => setDeleteConfirming(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={() => void deleteTask()}
                >
                  <Trash2 size={13} /> Delete task
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function PhaseConversation({
  workspace,
  phase,
  currentPhase,
}: {
  workspace: TaskWorkspace;
  phase: TaskPhase;
  currentPhase: TaskPhase;
}) {
  const phaseMessages = workspace.messages.filter((message) => message.phase === phase);
  const active = phase === currentPhase;
  const working = workspace.task.runtimeStatus === "agent_running" && active;
  const advance = active ? advanceForWorkspace(workspace, phase) : undefined;
  const composer = active && ["refine", "plan", "build", "review"].includes(phase);

  return (
    <div className="relay-phase-conversation">
      <header className="relay-phase-conversation-head">
        <div>
          <p className="kicker">{taskPhaseLabels[phase]} conversation</p>
          <h2>{phaseHeading(phase, workspace.task.runtimeStatus)}</h2>
        </div>
        {active ? (
          <span className="relay-current-phase">Current phase</span>
        ) : (
          <span>Phase history</span>
        )}
      </header>
      <div className="relay-conversation-stream">
        {phase === "refine" ? (
          <ConversationMessage
            role="user"
            content={workspace.task.initialRequest}
            createdAt={workspace.task.createdAt}
          />
        ) : null}
        {phaseMessages
          .filter(
            (message, index) => !(phase === "refine" && message.role === "user" && index === 0),
          )
          .map((message) => (
            <ConversationMessage
              key={message.id}
              role={message.role}
              content={message.content}
              createdAt={message.createdAt}
            />
          ))}
        <TaskAgentFeed
          taskId={workspace.task.id}
          phase={phase}
          runs={workspace.runs}
          initialEvents={workspace.agentEvents}
          working={working}
          afterTask={workspace.events[0]?.id ?? 0}
        />
        <PhaseEvidence workspace={workspace} phase={phase} />
      </div>
      {composer ? (
        <TaskPhaseComposer
          taskId={workspace.task.id}
          phase={phase as "refine" | "plan" | "build" | "review"}
          disabled={working || workspace.task.runtimeStatus === "failed"}
        />
      ) : null}
      {advance ? (
        <footer className="relay-phase-advance">
          <div>
            <strong>{advance.label}</strong>
            <p>{advance.description}</p>
          </div>
          <TaskAdvanceAction taskId={workspace.task.id} {...advance} />
        </footer>
      ) : null}
    </div>
  );
}

function ConversationMessage({
  role,
  content,
  createdAt,
}: {
  role: string;
  content: string;
  createdAt: string;
}) {
  return (
    <article className={`relay-dialog-message message-${role}`}>
      <div className="relay-person agent">{role === "user" ? "Y" : "A"}</div>
      <div>
        <header>
          <strong>{role === "user" ? "You" : "Relay agent"}</strong>
          <time>{new Date(createdAt).toLocaleString()}</time>
        </header>
        <p>{content}</p>
      </div>
    </article>
  );
}

function PhaseEvidence({ workspace, phase }: { workspace: TaskWorkspace; phase: TaskPhase }) {
  if (phase === "refine") {
    return (
      <section className="relay-phase-evidence">
        <p className="kicker">Live specification</p>
        <h3>{workspace.requirement?.title ?? "The requirement is being prepared"}</h3>
        {workspace.requirement ? (
          <div className="relay-compact-requirement">
            <p>{workspace.requirement.objective}</p>
            <strong>Acceptance criteria</strong>
            <ul>
              {workspace.requirement.acceptanceCriteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ul>
            {workspace.requirement.unresolvedQuestions
              .filter((question) => question.status === "open")
              .map((question) => (
                <p className="relay-evidence-warning" key={question.id}>
                  <CircleAlert size={12} /> {question.question}
                </p>
              ))}
          </div>
        ) : null}
        {workspace.attachments.map((attachment) => (
          <a
            className="relay-attachment-pill"
            href={`/api/attachments/${attachment.id}`}
            key={attachment.id}
          >
            <Paperclip size={11} /> {attachment.originalName}
          </a>
        ))}
      </section>
    );
  }
  if (phase === "plan") {
    return (
      <section className="relay-phase-evidence">
        <p className="kicker">Technical plan</p>
        <h3>
          {workspace.plan ? `${workspace.plan.commits.length} atomic commits` : "Plan pending"}
        </h3>
        <p>{workspace.plan?.understanding}</p>
        <div className="relay-plan-stream">
          {workspace.plan?.commits.map((commit) => (
            <article key={commit.id}>
              <span>{String(commit.order).padStart(2, "0")}</span>
              <div>
                <strong>{commit.title}</strong>
                <p>{commit.goal}</p>
                <small>{commit.files.join(" · ")}</small>
              </div>
            </article>
          ))}
        </div>
        {workspace.planComments.map((comment) => (
          <div className="relay-dialog-comment" key={comment.id}>
            <strong>You requested</strong>
            <p>{comment.content}</p>
          </div>
        ))}
      </section>
    );
  }
  if (phase === "build" || phase === "review" || phase === "done") {
    return (
      <section className="relay-phase-evidence">
        <p className="kicker">
          {phase === "review" ? "Review evidence" : "Implementation evidence"}
        </p>
        <div className="relay-evidence-summary">
          <strong>{workspace.commits.length} commits</strong>
          <strong>
            {workspace.tests.filter((test) => test.status === "passed").length} passing tests
          </strong>
          {workspace.task.worktreePath ? (
            <a className="button" href={`/api/tasks/${workspace.task.id}/git/diff`} target="_blank">
              Open total diff
            </a>
          ) : null}
        </div>
        {workspace.commits.map((commit) => (
          <article className="relay-dialog-commit" key={commit.id}>
            <GitCommitHorizontal size={14} />
            <div>
              <strong>{commit.message}</strong>
              <p>{commit.summary}</p>
            </div>
            <code>{commit.sha.slice(0, 8)}</code>
          </article>
        ))}
        {workspace.tests.map((test) => (
          <article className="relay-dialog-test" key={test.id}>
            <i className={`evidence-${test.status}`} />
            <div>
              <strong>{test.category}</strong>
              <code>{test.command}</code>
            </div>
            <span>{test.status}</span>
          </article>
        ))}
        {phase === "review"
          ? workspace.reviewComments.map((comment) => (
              <div className="relay-dialog-comment" key={comment.id}>
                <strong>Requested change</strong>
                <p>{comment.content}</p>
              </div>
            ))
          : null}
        {workspace.artifacts.map((artifact) => (
          <a
            className="relay-attachment-pill"
            href={`/api/artifacts/${artifact.id}`}
            key={artifact.id}
          >
            <FileText size={11} /> {artifact.type}
          </a>
        ))}
      </section>
    );
  }
  if (phase === "deploy") {
    return (
      <section className="relay-phase-evidence">
        <p className="kicker">Protected delivery</p>
        <h3>
          {workspace.task.stage === "ready_to_deploy"
            ? "Ready to choose a deployment"
            : "Deployment activity"}
        </h3>
        <DeploymentActions
          taskId={workspace.task.id}
          stage={workspace.task.stage}
          recipes={workspace.deploymentRecipes}
          deployments={workspace.deployments}
          steps={workspace.deploymentSteps}
        />
      </section>
    );
  }
  return null;
}

function ActivityRail({
  workspace,
  working,
  currentPhase,
}: {
  workspace: TaskWorkspace;
  working: boolean;
  currentPhase: TaskPhase;
}) {
  return (
    <aside className="relay-dialog-activity">
      <header>
        <h2>Activity & status</h2>
        {working ? (
          <span className="relay-runtime runtime-agent_running">
            <i /> Agent working
          </span>
        ) : null}
      </header>
      <div className="relay-activity-current">
        <span>Current phase</span>
        <strong>{taskPhaseLabels[currentPhase]}</strong>
        <small>{runtimeLabel(workspace.task.runtimeStatus, workspace.task.stage)}</small>
      </div>
      <div className="relay-dialog-activity-list">
        {workspace.events.slice(0, 18).map((event) => (
          <div className="relay-activity-item" key={event.id}>
            <i />
            <span>{eventLabel(event.type)}</span>
            <time>{new Date(event.createdAt).toLocaleString()}</time>
          </div>
        ))}
      </div>
      <div className="relay-policy-note">
        <ShieldCheck size={14} />
        <div>
          <strong>Manual deployment policy</strong>
          <p>
            Dragging to Deploy never executes a recipe. Exact SHA confirmation is still required.
          </p>
        </div>
      </div>
    </aside>
  );
}

type AdvanceConfig = {
  destination: AdvanceDestination;
  label: string;
  description: string;
  nextPhase: string;
};

function advanceForWorkspace(
  workspace: TaskWorkspace,
  phase: TaskPhase,
): AdvanceConfig | undefined {
  if (workspace.task.runtimeStatus === "agent_running" || workspace.task.runtimeStatus === "failed")
    return undefined;
  if (phase === "refine" && workspace.requirement) {
    return {
      destination: "planning",
      label: "Approve & start planning",
      description: "Freeze this requirement and start a read-only technical plan.",
      nextPhase: "plan",
    };
  }
  if (phase === "plan" && workspace.plan) {
    return {
      destination: "implementation",
      label: "Approve & start implementation",
      description: "Approve this plan and create its isolated implementation worktree.",
      nextPhase: "build",
    };
  }
  if (
    phase === "build" &&
    workspace.task.runtimeStatus === "waiting_for_user" &&
    workspace.events.some((event) =>
      ["implementation.ready_for_review", "review.changes_ready_for_review"].includes(event.type),
    )
  ) {
    return {
      destination: "review",
      label: "Move to review",
      description: "Implementation and validation are complete. Open the reviewed evidence gate.",
      nextPhase: "review",
    };
  }
  if (phase === "review") {
    return {
      destination: "ready_to_deploy",
      label: "Approve for deployment",
      description: "Approve the reviewed SHA. No deployment command will run yet.",
      nextPhase: "deploy",
    };
  }
  return undefined;
}

function phaseHeading(phase: TaskPhase, runtimeStatus: string): string {
  if (runtimeStatus === "agent_running") return `Relay is working in ${taskPhaseLabels[phase]}`;
  return (
    {
      refine: "Shape the requirement",
      plan: "Agree on the implementation plan",
      build: "Follow implementation as it happens",
      review: "Review the completed work",
      deploy: "Deliver the exact reviewed revision",
      done: "Completed task record",
    } satisfies Record<TaskPhase, string>
  )[phase];
}

function runtimeLabel(runtimeStatus: string, stage: string): string {
  if (stage === "ready_to_deploy") return "ready to deploy";
  return runtimeStatus.replaceAll("_", " ");
}

function eventLabel(value: string): string {
  return value.replaceAll(".", " · ").replaceAll("_", " ");
}
