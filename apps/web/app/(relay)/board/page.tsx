import { AlertCircle, Bot, Filter, Plus, Search } from "lucide-react";
import Link from "next/link";

import { projects, taskCommits, tasks, testRuns } from "@relay/db";
import { taskStageSchema, type TaskStage } from "@relay/domain";
import { and, desc, eq, like, or, type SQL } from "drizzle-orm";

import { database } from "@/server/database";

export const dynamic = "force-dynamic";

const stages: Array<{ id: TaskStage; label: string }> = [
  { id: "refinement", label: "Refinement" },
  { id: "planning", label: "Planning" },
  { id: "implementation", label: "Implementation" },
  { id: "review", label: "Review" },
  { id: "ready_to_deploy", label: "Ready to Deploy" },
  { id: "deploying", label: "Deploying" },
  { id: "done", label: "Done" },
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BoardPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const search = typeof query.q === "string" ? query.q.trim() : "";
  const project = typeof query.project === "string" ? query.project : "";
  const priority = typeof query.priority === "string" ? query.priority : "";
  const attention = query.view === "attention";
  const active = query.view === "active";
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
  const commitCounts = new Map<string, number>();
  for (const commit of commits)
    commitCounts.set(commit.taskId, (commitCounts.get(commit.taskId) ?? 0) + 1);
  const latestTest = new Map<string, (typeof tests)[number]>();
  for (const test of tests) if (!latestTest.has(test.taskId)) latestTest.set(test.taskId, test);

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
          <Link className="button button-primary" href="/tasks/new">
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
      <section className="relay-board" aria-label="Relay task board">
        {stages.map((stage) => {
          const stageRows = rows.filter(
            (row) => taskStageSchema.parse(row.task.stage) === stage.id,
          );
          return (
            <section className="relay-column" key={stage.id} aria-labelledby={`column-${stage.id}`}>
              <header>
                <h2 id={`column-${stage.id}`}>{stage.label}</h2>
                <span>{String(stageRows.length).padStart(2, "0")}</span>
              </header>
              <div className="relay-column-cards">
                {stageRows.map(({ task, project: taskProject }) => (
                  <Link
                    className="surface relay-task-card"
                    href={`/tasks/${task.id}`}
                    key={task.id}
                  >
                    <div className="relay-card-project">
                      <span>{taskProject.name}</span>
                      <span>{task.type}</span>
                    </div>
                    <h3>{task.title}</h3>
                    <div className="relay-card-badges">
                      <span className={`relay-priority priority-${task.priority}`}>
                        {task.priority}
                      </span>
                      {task.runtimeStatus === "blocked" || task.runtimeStatus === "failed" ? (
                        <span className="relay-blocked">{task.runtimeStatus}</span>
                      ) : null}
                    </div>
                    <div className="relay-card-runtime">
                      <span className={`relay-runtime runtime-${task.runtimeStatus}`}>
                        <i />
                        {runtimeLabel(task.runtimeStatus)}
                      </span>
                      <time dateTime={task.lastActivityAt}>
                        {relativeTime(task.lastActivityAt)}
                      </time>
                    </div>
                    {task.stage === "implementation" ||
                    task.stage === "planning" ||
                    task.stage === "deploying" ? (
                      <div className="relay-progress">
                        <i style={{ width: `${progress(task.stage, task.currentPlanCommit)}%` }} />
                      </div>
                    ) : null}
                    <div className="relay-card-footer">
                      <span>{commitCounts.get(task.id) ?? 0} commits</span>
                      <span>{testLabel(latestTest.get(task.id)?.status)}</span>
                    </div>
                  </Link>
                ))}
                {!stageRows.length ? <div className="relay-column-empty">No tasks</div> : null}
              </div>
            </section>
          );
        })}
      </section>
    </div>
  );
}

function runtimeLabel(value: string): string {
  return (
    (
      {
        idle: "idle",
        agent_running: "agent running",
        waiting_for_user: "needs input",
        blocked: "blocked",
        failed: "failed",
        stopped: "stopped",
      } as Record<string, string>
    )[value] ?? value
  );
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
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

function progress(stage: string, current: number): number {
  if (stage === "planning") return 35;
  if (stage === "deploying") return 65;
  return Math.min(90, 15 + current * 18);
}
