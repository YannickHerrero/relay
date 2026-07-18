import { AlertCircle, Bot, Filter, Plus, Search } from "lucide-react";
import Link from "next/link";

import {
  planVersions,
  projects,
  requirementDrafts,
  taskCommits,
  taskEvents,
  tasks,
  testRuns,
} from "@relay/db";
import {
  refinedRequirementSchema,
  taskPhaseForStage,
  taskStageSchema,
  type TaskPhase,
} from "@relay/domain";
import { and, desc, eq, inArray, like, or, type SQL } from "drizzle-orm";

import { TaskWorkspaceDialog } from "@/components/task-workspace-dialog";
import { Workboard, type BoardTask } from "@/components/workboard";
import { database } from "@/server/database";
import { loadTaskWorkspace } from "@/server/task-workspace";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BoardPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const search = typeof query.q === "string" ? query.q.trim() : "";
  const project = typeof query.project === "string" ? query.project : "";
  const priority = typeof query.priority === "string" ? query.priority : "";
  const attention = query.view === "attention";
  const active = query.view === "active";
  const selectedTaskId = typeof query.task === "string" ? query.task : undefined;
  const selectedPhase = typeof query.phase === "string" ? query.phase : undefined;
  const conditions: SQL[] = [];
  if (search) conditions.push(like(tasks.title, `%${search}%`));
  if (project) conditions.push(eq(tasks.projectId, project));
  if (priority) conditions.push(eq(tasks.priority, priority));
  if (attention)
    conditions.push(
      or(
        eq(tasks.runtimeStatus, "waiting_for_user"),
        eq(tasks.runtimeStatus, "blocked"),
        eq(tasks.runtimeStatus, "failed"),
      )!,
    );
  if (active) conditions.push(eq(tasks.runtimeStatus, "agent_running"));

  const { db } = database();
  const rows = db
    .select({ task: tasks, project: projects })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(tasks.lastActivityAt))
    .all();
  const projectRows = db.select().from(projects).orderBy(projects.name).all();
  const commits = db.select().from(taskCommits).all();
  const tests = db.select().from(testRuns).orderBy(desc(testRuns.startedAt)).all();
  const drafts = db.select().from(requirementDrafts).all();
  const plans = db.select().from(planVersions).orderBy(desc(planVersions.version)).all();
  const readyEvents = db
    .select()
    .from(taskEvents)
    .where(
      inArray(taskEvents.type, [
        "implementation.ready_for_review",
        "review.changes_ready_for_review",
      ]),
    )
    .all();
  const commitCounts = new Map<string, number>();
  for (const commit of commits)
    commitCounts.set(commit.taskId, (commitCounts.get(commit.taskId) ?? 0) + 1);
  const latestTest = new Map<string, (typeof tests)[number]>();
  for (const test of tests) if (!latestTest.has(test.taskId)) latestTest.set(test.taskId, test);
  const latestPlanTaskIds = new Set(plans.map((plan) => plan.taskId));
  const readyTaskIds = new Set(readyEvents.map((event) => event.taskId));
  const requirements = new Map(
    drafts.map((draft) => [draft.taskId, refinedRequirementSchema.safeParse(draft.content)]),
  );
  const boardTasks: BoardTask[] = rows.map(({ task, project: taskProject }) => {
    const stage = taskStageSchema.parse(task.stage);
    const phase = taskPhaseForStage(stage);
    return {
      id: task.id,
      projectName: taskProject.name,
      type: task.type,
      priority: task.priority,
      title: task.title,
      phase,
      stage,
      runtimeStatus: task.runtimeStatus,
      lastActivityAt: task.lastActivityAt,
      currentPlanCommit: task.currentPlanCommit,
      commits: commitCounts.get(task.id) ?? 0,
      testStatus: latestTest.get(task.id)?.status,
      advance: boardAdvance(
        task,
        phase,
        requirements.get(task.id),
        latestPlanTaskIds,
        readyTaskIds,
      ),
    };
  });
  const workspace = selectedTaskId ? loadTaskWorkspace(selectedTaskId) : undefined;
  const queryString = boardQueryString({
    search,
    project,
    priority,
    view: attention ? "attention" : active ? "active" : "",
  });

  return (
    <div className="relay-board-page">
      <header className="relay-board-head">
        <div>
          <p className="kicker">Delivery workflow</p>
          <h1>Workboard</h1>
          <p>
            {rows.length} tasks across {projectRows.length}{" "}
            {projectRows.length === 1 ? "repository" : "repositories"}
          </p>
        </div>
        <div className="relay-board-actions">
          <Link
            className={`button ${attention ? "button-primary" : ""}`}
            href={attention ? "/board" : "/board?view=attention"}
          >
            <AlertCircle size={13} /> Needs attention
          </Link>
          <Link
            className={`button ${active ? "button-primary" : ""}`}
            href={active ? "/board" : "/board?view=active"}
          >
            <Bot size={13} /> Active agents
          </Link>
          <Link
            className="button button-primary"
            href={project ? `/tasks/new?project=${encodeURIComponent(project)}` : "/tasks/new"}
          >
            <Plus size={14} /> New task
          </Link>
        </div>
      </header>
      <form className="relay-board-filters">
        <label className="relay-search">
          <Search size={13} />
          <span className="sr-only">Search tasks</span>
          <input name="q" defaultValue={search} placeholder="Search tasks" />
        </label>
        <label>
          <span className="sr-only">Project</span>
          <select name="project" defaultValue={project}>
            <option value="">All projects</option>
            {projectRows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Priority</span>
          <select name="priority" defaultValue={priority}>
            <option value="">All priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <button className="button" type="submit">
          <Filter size={13} /> Apply
        </button>
        {search || project || priority ? (
          <Link className="relay-clear-filter" href="/board">
            Clear
          </Link>
        ) : null}
      </form>
      <Workboard tasks={boardTasks} queryString={queryString} />
      {workspace ? (
        <TaskWorkspaceDialog workspace={workspace} requestedPhase={selectedPhase} />
      ) : null}
    </div>
  );
}

function boardAdvance(
  task: typeof tasks.$inferSelect,
  phase: TaskPhase,
  requirement: ReturnType<typeof refinedRequirementSchema.safeParse> | undefined,
  planTaskIds: Set<string>,
  readyTaskIds: Set<string>,
): BoardTask["advance"] {
  if (["agent_running", "failed", "blocked"].includes(task.runtimeStatus)) return undefined;
  if (phase === "refine" && requirement?.success) {
    const blocking = requirement.data.unresolvedQuestions.some(
      (question) => question.blocking && question.status === "open",
    );
    if (!blocking)
      return {
        destination: "planning",
        phase: "plan",
        label: "Approve & start planning",
        description: "Freeze the current requirement and begin technical planning.",
      };
  }
  if (phase === "plan" && planTaskIds.has(task.id))
    return {
      destination: "implementation",
      phase: "build",
      label: "Approve & start implementation",
      description: "Approve the plan and create its isolated implementation worktree.",
    };
  if (phase === "build" && task.runtimeStatus === "waiting_for_user" && readyTaskIds.has(task.id))
    return {
      destination: "review",
      phase: "review",
      label: "Move to review",
      description: "Implementation and validation have completed successfully.",
    };
  if (phase === "review")
    return {
      destination: "ready_to_deploy",
      phase: "deploy",
      label: "Approve for deployment",
      description: "Approve the reviewed revision without running a deployment command.",
    };
  return undefined;
}

function boardQueryString({
  search,
  project,
  priority,
  view,
}: {
  search: string;
  project: string;
  priority: string;
  view: string;
}): string {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (project) params.set("project", project);
  if (priority) params.set("priority", priority);
  if (view) params.set("view", view);
  return params.toString();
}
