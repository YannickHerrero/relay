import { ArrowLeft, CircleAlert, GitCommitHorizontal, Paperclip, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  agentEvents,
  agentRuns,
  artifacts,
  deployments,
  messages,
  planComments,
  planVersions,
  projects,
  requirementDrafts,
  specificationVersions,
  taskAttachments,
  taskCommits,
  taskEvents,
  tasks,
  testRuns,
} from "@relay/db";
import {
  implementationPlanSchema,
  refinedRequirementSchema,
  type RefinedRequirement,
} from "@relay/domain";
import { asc, desc, eq } from "drizzle-orm";

import { ConversationComposer } from "@/components/conversation-composer";
import { ImplementationControls } from "@/components/implementation-controls";
import { PlanFeedback } from "@/components/plan-feedback";
import { ReviewActions } from "@/components/review-actions";
import { SpecificationEditor } from "@/components/specification-editor";
import { TaskLiveRefresh } from "@/components/task-live-refresh";
import { WorkflowAction } from "@/components/workflow-action";
import { database } from "@/server/database";

export const dynamic = "force-dynamic";

const tabs = [
  ["overview", "Overview"],
  ["conversation", "Conversation"],
  ["specification", "Specification"],
  ["plan", "Plan"],
  ["execution", "Execution"],
  ["git", "Git / Diff"],
  ["tests", "Tests / Artifacts"],
  ["deployment", "Deployment"],
  ["history", "History"],
] as const;

type Tab = (typeof tabs)[number][0];
type MessageRow = typeof messages.$inferSelect;
type ArtifactRow = typeof artifacts.$inferSelect;
type DeploymentRow = typeof deployments.$inferSelect;

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { taskId } = await params;
  const requestedTab = (await searchParams).tab;
  const tab: Tab = tabs.some(([id]) => id === requestedTab) ? (requestedTab as Tab) : "overview";
  const { db } = database();
  const row = db
    .select({ task: tasks, project: projects })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId))
    .get();
  if (!row) notFound();

  const conversation = db
    .select()
    .from(messages)
    .where(eq(messages.taskId, taskId))
    .orderBy(asc(messages.createdAt))
    .all();
  const draft = db
    .select()
    .from(requirementDrafts)
    .where(eq(requirementDrafts.taskId, taskId))
    .get();
  const specifications = db
    .select()
    .from(specificationVersions)
    .where(eq(specificationVersions.taskId, taskId))
    .orderBy(desc(specificationVersions.version))
    .all();
  const plans = db
    .select()
    .from(planVersions)
    .where(eq(planVersions.taskId, taskId))
    .orderBy(desc(planVersions.version))
    .all();
  const comments = plans[0]
    ? db
        .select()
        .from(planComments)
        .where(eq(planComments.planVersionId, plans[0].id))
        .orderBy(asc(planComments.createdAt))
        .all()
    : [];
  const runs = db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.taskId, taskId))
    .orderBy(desc(agentRuns.startedAt))
    .all();
  const runEvents = db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.taskId, taskId))
    .orderBy(desc(agentEvents.id))
    .limit(200)
    .all()
    .reverse();
  const commits = db
    .select()
    .from(taskCommits)
    .where(eq(taskCommits.taskId, taskId))
    .orderBy(asc(taskCommits.order))
    .all();
  const tests = db
    .select()
    .from(testRuns)
    .where(eq(testRuns.taskId, taskId))
    .orderBy(desc(testRuns.startedAt))
    .all();
  const taskArtifacts = db
    .select()
    .from(artifacts)
    .where(eq(artifacts.taskId, taskId))
    .orderBy(desc(artifacts.createdAt))
    .all();
  const taskDeployments = db
    .select()
    .from(deployments)
    .where(eq(deployments.taskId, taskId))
    .orderBy(desc(deployments.createdAt))
    .all();
  const attachments = db
    .select()
    .from(taskAttachments)
    .where(eq(taskAttachments.taskId, taskId))
    .orderBy(asc(taskAttachments.createdAt))
    .all();
  const history = db
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(desc(taskEvents.id))
    .limit(200)
    .all();
  const requirement = parseRequirement(draft?.content ?? specifications[0]?.content);
  const plan = plans[0] ? implementationPlanSchema.safeParse(plans[0].content) : undefined;
  const latestEventId = history[0]?.id ?? 0;

  return (
    <div className="relay-task-page">
      <TaskLiveRefresh taskId={taskId} after={latestEventId} />
      <header className="relay-task-head">
        <Link href="/board" className="relay-back">
          <ArrowLeft size={13} /> Board
        </Link>
        <div className="relay-task-title-row">
          <div>
            <p className="kicker">
              {row.project.name} · {row.task.type} · {row.task.priority}
            </p>
            <h1>{row.task.title}</h1>
            <div className="relay-task-status">
              <span>{stageLabel(row.task.stage)}</span>
              <span className={`relay-runtime runtime-${row.task.runtimeStatus}`}>
                <i />
                {row.task.runtimeStatus.replaceAll("_", " ")}
              </span>
              <span className="mono">base {row.task.baseBranch}</span>
            </div>
          </div>
          {row.task.stage === "implementation" ? (
            <ImplementationControls taskId={taskId} status={row.task.runtimeStatus} />
          ) : row.task.runtimeStatus === "blocked" || row.task.runtimeStatus === "failed" ? (
            <div className="relay-task-alert">
              <CircleAlert size={14} /> {row.task.blockedReason ?? "Intervention required"}
            </div>
          ) : null}
        </div>
      </header>
      <nav className="relay-task-tabs" aria-label="Task details">
        {tabs.map(([id, label]) => (
          <Link className={tab === id ? "active" : ""} href={`/tasks/${taskId}?tab=${id}`} key={id}>
            {label}
            {id === "plan" && plans.length ? (
              <small>{String(plans[0]?.version).padStart(2, "0")}</small>
            ) : null}
          </Link>
        ))}
      </nav>
      <div className="relay-task-layout">
        <main className="relay-task-main">
          {tab === "overview" ? (
            <Overview
              taskId={taskId}
              task={row.task}
              project={row.project}
              requirement={requirement}
              runs={runs}
              commits={commits}
              tests={tests}
            />
          ) : null}
          {tab === "conversation" ? (
            <Conversation
              taskId={taskId}
              messages={conversation}
              requirement={requirement}
              editable={row.task.stage === "refinement"}
            />
          ) : null}
          {tab === "specification" ? (
            <Specification
              requirement={requirement}
              versions={specifications}
              taskId={taskId}
              editable={row.task.stage === "refinement"}
            />
          ) : null}
          {tab === "plan" ? (
            <Plan
              taskId={taskId}
              stage={row.task.stage}
              plan={plan?.success ? plan.data : undefined}
              versions={plans}
              comments={comments}
            />
          ) : null}
          {tab === "execution" ? <Execution runs={runs} events={runEvents} /> : null}
          {tab === "git" ? <GitEvidence task={row.task} commits={commits} /> : null}
          {tab === "tests" ? (
            <TestEvidence tests={tests} artifacts={taskArtifacts} attachments={attachments} />
          ) : null}
          {tab === "deployment" ? (
            <DeploymentEvidence deployments={taskDeployments} stage={row.task.stage} />
          ) : null}
          {tab === "history" ? <History events={history} /> : null}
        </main>
        <aside className="relay-task-activity">
          <h2>Activity & status</h2>
          {history.slice(0, 12).map((event) => (
            <div className="relay-activity-item" key={event.id}>
              <i />
              <span>{eventLabel(event.type)}</span>
              <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
            </div>
          ))}
          <div className="relay-policy-note">
            <ShieldCheck size={14} />
            <div>
              <strong>Manual deployment policy</strong>
              <p>Agents can move this task to Review, but cannot trigger a delivery target.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Overview({
  taskId,
  task,
  project,
  requirement,
  runs,
  commits,
  tests,
}: {
  taskId: string;
  task: typeof tasks.$inferSelect;
  project: typeof projects.$inferSelect;
  requirement: RefinedRequirement | undefined;
  runs: Array<typeof agentRuns.$inferSelect>;
  commits: Array<typeof taskCommits.$inferSelect>;
  tests: Array<typeof testRuns.$inferSelect>;
}) {
  return (
    <div className="relay-panel">
      <p className="kicker">Task snapshot</p>
      <h2>Delivery overview</h2>
      <div className="relay-overview-grid">
        <section className="surface">
          <span>Project</span>
          <strong>{project.name}</strong>
          <small className="mono">{project.repositoryPath}</small>
        </section>
        <section className="surface">
          <span>Current gate</span>
          <strong>{stageLabel(task.stage)}</strong>
          <small>{task.runtimeStatus.replaceAll("_", " ")}</small>
        </section>
        <section className="surface">
          <span>Agent runs</span>
          <strong>{runs.length}</strong>
          <small>{runs[0]?.role ?? "No role active"}</small>
        </section>
        <section className="surface">
          <span>Evidence</span>
          <strong>
            {commits.length} commits · {tests.length} tests
          </strong>
          <small>{tests[0]?.status ?? "Not run"}</small>
        </section>
      </div>
      <section className="relay-content-section">
        <p className="kicker">Original request</p>
        <p>{task.initialRequest}</p>
      </section>
      <section className="relay-content-section">
        <p className="kicker">Current objective</p>
        <p>
          {requirement?.objective ??
            "The product refiner is preparing the first structured requirement."}
        </p>
      </section>
      {task.stage === "review" ? (
        <ReviewActions
          taskId={taskId}
          commits={commits.map((commit) => ({ sha: commit.sha, message: commit.message }))}
        />
      ) : null}
    </div>
  );
}

function Conversation({
  taskId,
  messages,
  requirement,
  editable,
}: {
  taskId: string;
  messages: MessageRow[];
  requirement: RefinedRequirement | undefined;
  editable: boolean;
}) {
  return (
    <div className="relay-refinement-grid">
      <section className="relay-panel relay-conversation">
        <p className="kicker">Requirement conversation</p>
        <h2>{editable ? "Refine what Relay should build" : "Approved conversation"}</h2>
        <div className="relay-messages">
          {messages.map((message) => (
            <article key={message.id}>
              <div className={`relay-person ${message.role === "agent" ? "agent" : ""}`}>
                {message.role === "agent" ? "A" : "Y"}
              </div>
              <div>
                <header>
                  <strong>{message.role === "agent" ? "Relay agent" : "You"}</strong>
                  <time>
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </header>
                <p>{message.content}</p>
              </div>
            </article>
          ))}
        </div>
        <ConversationComposer taskId={taskId} disabled={!editable} />
      </section>
      <section className="relay-panel relay-live-spec">
        <p className="kicker">Live specification</p>
        <h2>{requirement?.title ?? "Being prepared"}</h2>
        {requirement ? (
          <RequirementSummary requirement={requirement} />
        ) : (
          <p className="relay-muted-copy">
            The structured draft will update after the first agent turn.
          </p>
        )}
      </section>
    </div>
  );
}

function Specification({
  requirement,
  versions,
  taskId,
  editable,
}: {
  requirement: RefinedRequirement | undefined;
  versions: Array<typeof specificationVersions.$inferSelect>;
  taskId: string;
  editable: boolean;
}) {
  return (
    <div className="relay-panel">
      <div className="relay-panel-head">
        <div>
          <p className="kicker">
            {versions.length ? `Specification v${versions[0]?.version}` : "Live draft"}
          </p>
          <h2>Approved product behavior</h2>
        </div>
        {requirement ? (
          <SpecificationEditor taskId={taskId} content={requirement} editable={editable} />
        ) : null}
      </div>
      {requirement ? (
        <RequirementSummary requirement={requirement} full />
      ) : (
        <p className="relay-muted-copy">No structured specification is available yet.</p>
      )}
      {editable && requirement ? (
        <div className="relay-gate-actions">
          <div>
            <strong>Requirement approval gate</strong>
            <p>Approval freezes an immutable specification and starts read-only planning.</p>
          </div>
          <WorkflowAction
            endpoint={`/api/tasks/${taskId}/requirement/approve`}
            label="Approve requirement and move to planning"
            redirectTab="plan"
            icon="next"
            confirm="Freeze this requirement and start technical planning?"
          />
        </div>
      ) : null}
      {versions.length > 1 ? (
        <div className="relay-version-list">
          <h3>Version history</h3>
          {versions.map((version) => (
            <span key={version.id}>
              v{version.version} ·{" "}
              {version.approvedAt
                ? `approved ${new Date(version.approvedAt).toLocaleString()}`
                : "draft"}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RequirementSummary({
  requirement,
  full = false,
}: {
  requirement: RefinedRequirement;
  full?: boolean;
}) {
  const sections = [
    { label: "Problem", values: [requirement.problem] },
    { label: "Objective", values: [requirement.objective] },
    { label: "Expected behavior", values: requirement.expectedBehavior },
    { label: "Acceptance criteria", values: requirement.acceptanceCriteria },
    ...(full
      ? [
          { label: "Edge cases", values: requirement.edgeCases },
          { label: "Constraints", values: requirement.constraints },
          { label: "Out of scope", values: requirement.outOfScope },
        ]
      : []),
  ];
  return (
    <div className="relay-requirement-sections">
      {sections.map((section) => (
        <section key={section.label}>
          <h3>{section.label}</h3>
          {section.values.length ? (
            <ul>
              {section.values.map((value, index) => (
                <li key={`${section.label}-${index}`}>{value}</li>
              ))}
            </ul>
          ) : (
            <p>None recorded</p>
          )}
        </section>
      ))}
      {requirement.unresolvedQuestions.length ? (
        <section className="relay-open-questions">
          <h3>Open questions</h3>
          {requirement.unresolvedQuestions.map((question) => (
            <p key={question.id}>
              <b>{question.blocking ? "Blocking" : "Optional"}</b>
              {question.question}
            </p>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function Plan({
  taskId,
  stage,
  plan,
  versions,
  comments,
}: {
  taskId: string;
  stage: string;
  plan: ReturnType<typeof implementationPlanSchema.parse> | undefined;
  versions: Array<typeof planVersions.$inferSelect>;
  comments: Array<typeof planComments.$inferSelect>;
}) {
  if (!plan)
    return (
      <EmptyPanel
        kicker="Technical planning"
        title="No plan yet"
        copy="Planning starts automatically after the requirement is approved."
      />
    );
  return (
    <div className="relay-panel">
      <p className="kicker">Technical plan · revision {versions[0]?.version}</p>
      <h2>{plan.commits.length} independently reviewable commits</h2>
      <p className="relay-lead">{plan.understanding}</p>
      <div className="relay-plan-commits">
        {plan.commits.map((commit) => (
          <article key={commit.id}>
            <span>{String(commit.order).padStart(2, "0")}</span>
            <div>
              <h3>{commit.title}</h3>
              <p>{commit.goal}</p>
              <small>{commit.files.join(" · ") || "Files determined during implementation"}</small>
            </div>
          </article>
        ))}
      </div>
      {comments.map((comment) => (
        <div className="relay-comment" key={comment.id}>
          <strong>Plan comment · {comment.targetType}</strong>
          <p>{comment.content}</p>
        </div>
      ))}
      {stage === "planning" ? (
        <>
          <PlanFeedback taskId={taskId} commits={plan.commits} />
          <div className="relay-gate-actions">
            <WorkflowAction
              endpoint={`/api/tasks/${taskId}/plan/return`}
              label="Return to refinement"
              redirectTab="conversation"
              icon="return"
              tone="default"
            />
            <WorkflowAction
              endpoint={`/api/tasks/${taskId}/plan/approve`}
              label="Approve plan and start implementation"
              redirectTab="execution"
              icon="next"
              confirm={`Approve plan v${versions[0]?.version} and create its isolated worktree?`}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function Execution({
  runs,
  events,
}: {
  runs: Array<typeof agentRuns.$inferSelect>;
  events: Array<typeof agentEvents.$inferSelect>;
}) {
  return (
    <div className="relay-panel">
      <p className="kicker">Agent execution</p>
      <h2>{runs[0]?.status === "running" ? "Live work" : "Run evidence"}</h2>
      {events.length ? (
        <div className="relay-terminal">
          {events.map((event) => (
            <div key={event.id}>
              <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
              <span>{event.type}</span>
              <code>{eventText(event.payload)}</code>
            </div>
          ))}
        </div>
      ) : (
        <p className="relay-muted-copy">
          Commands and streamed evidence will appear when an agent runs.
        </p>
      )}
    </div>
  );
}

function GitEvidence({
  task,
  commits,
}: {
  task: typeof tasks.$inferSelect;
  commits: Array<typeof taskCommits.$inferSelect>;
}) {
  return (
    <div className="relay-panel">
      <p className="kicker">Git evidence</p>
      <h2>
        {commits.length ? `${commits.length} atomic commits` : "No implementation commits yet"}
      </h2>
      <div className="relay-git-summary">
        <span>Branch</span>
        <code>{task.taskBranch ?? "Created after plan approval"}</code>
        <span>Worktree</span>
        <code>{task.worktreePath ?? "Not prepared"}</code>
      </div>
      {commits.map((commit) => (
        <article className="relay-git-commit" key={commit.id}>
          <GitCommitHorizontal size={15} />
          <div>
            <strong>{commit.message}</strong>
            <p>{commit.summary}</p>
          </div>
          <code>{commit.sha.slice(0, 8)}</code>
        </article>
      ))}
    </div>
  );
}

function TestEvidence({
  tests,
  artifacts,
  attachments,
}: {
  tests: Array<typeof testRuns.$inferSelect>;
  artifacts: ArtifactRow[];
  attachments: Array<typeof taskAttachments.$inferSelect>;
}) {
  return (
    <div className="relay-panel">
      <p className="kicker">Validation evidence</p>
      <h2>Tests & artifacts</h2>
      <div className="relay-evidence-list">
        {tests.map((test) => (
          <article key={test.id}>
            <i className={`evidence-${test.status}`} />
            <div>
              <strong>{test.category}</strong>
              <code>{test.command}</code>
            </div>
            <span>
              {test.status}
              {test.durationMs ? ` · ${(test.durationMs / 1000).toFixed(1)}s` : ""}
            </span>
          </article>
        ))}
        {!tests.length ? <p className="relay-muted-copy">No configured test has run yet.</p> : null}
      </div>
      {attachments.length || artifacts.length ? (
        <section className="relay-artifacts">
          <h3>
            <Paperclip size={13} /> Files
          </h3>
          {[
            ...attachments.map((item) => ({
              id: item.id,
              label: item.originalName,
              type: item.type,
            })),
            ...artifacts.map((item) => ({
              id: item.id,
              label: item.path.split("/").at(-1) ?? item.path,
              type: item.type,
            })),
          ].map((item) => (
            <div key={item.id}>
              <span>{item.label}</span>
              <small>{item.type}</small>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function DeploymentEvidence({
  deployments,
  stage,
}: {
  deployments: DeploymentRow[];
  stage: string;
}) {
  return (
    <div className="relay-panel">
      <p className="kicker">Manual deployment only</p>
      <h2>
        {stage === "ready_to_deploy"
          ? "Choose an explicit delivery action"
          : "No deployment is armed"}
      </h2>
      <p className="relay-lead">
        Relay snapshots the exact SHA and requires confirmation before running any recipe.
      </p>
      {deployments.map((deployment) => (
        <article className="relay-deployment-row" key={deployment.id}>
          <span
            className={`relay-runtime runtime-${deployment.status === "failed" ? "failed" : deployment.status === "running" ? "agent_running" : "idle"}`}
          >
            <i />
            {deployment.status}
          </span>
          <div>
            <strong>{deployment.recipeId}</strong>
            <code>{deployment.commitSha.slice(0, 10)}</code>
          </div>
          {deployment.resultUrl ? <a href={deployment.resultUrl}>Open result</a> : null}
        </article>
      ))}
    </div>
  );
}

function History({ events }: { events: Array<typeof taskEvents.$inferSelect> }) {
  return (
    <div className="relay-panel">
      <p className="kicker">Immutable timeline</p>
      <h2>Task history</h2>
      <div className="relay-full-history">
        {events.map((event) => (
          <article key={event.id}>
            <i />
            <div>
              <strong>{eventLabel(event.type)}</strong>
              <p>{JSON.stringify(event.payload)}</p>
            </div>
            <time>{new Date(event.createdAt).toLocaleString()}</time>
          </article>
        ))}
      </div>
    </div>
  );
}

function EmptyPanel({ kicker, title, copy }: { kicker: string; title: string; copy: string }) {
  return (
    <div className="relay-panel">
      <p className="kicker">{kicker}</p>
      <h2>{title}</h2>
      <p className="relay-muted-copy">{copy}</p>
    </div>
  );
}
function parseRequirement(value: unknown): RefinedRequirement | undefined {
  const result = refinedRequirementSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
function stageLabel(value: string): string {
  return value
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}
function eventLabel(value: string): string {
  return value.replaceAll(".", " · ").replaceAll("_", " ");
}
function eventText(value: unknown): string {
  if (!value || typeof value !== "object") return String(value ?? "");
  const event = value as Record<string, unknown>;
  return typeof event.text === "string"
    ? event.text
    : typeof event.command === "string"
      ? event.command
      : typeof event.message === "string"
        ? event.message
        : "";
}
