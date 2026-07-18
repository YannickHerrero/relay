import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  ...timestamps,
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [uniqueIndex("sessions_token_hash_idx").on(table.tokenHash)],
);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  repositoryPath: text("repository_path").notNull().unique(),
  defaultBranch: text("default_branch").notNull(),
  projectType: text("project_type").notNull(),
  archivedAt: text("archived_at"),
  ...timestamps,
});

export const projectConfigVersions = sqliteTable(
  "project_config_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    source: text("source").notNull(),
    hash: text("hash").notNull(),
    content: text("content", { mode: "json" }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("project_config_version_idx").on(table.projectId, table.version)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    title: text("title").notNull(),
    initialRequest: text("initial_request").notNull(),
    type: text("type").notNull(),
    priority: text("priority").notNull(),
    stage: text("stage").notNull(),
    runtimeStatus: text("runtime_status").notNull(),
    baseBranch: text("base_branch").notNull(),
    taskBranch: text("task_branch"),
    worktreePath: text("worktree_path"),
    activeSpecificationVersionId: text("active_specification_version_id"),
    activePlanVersionId: text("active_plan_version_id"),
    currentPlanCommit: integer("current_plan_commit").notNull().default(0),
    version: integer("version").notNull().default(1),
    blockedReason: text("blocked_reason"),
    lastActivityAt: text("last_activity_at").notNull(),
    ...timestamps,
  },
  (table) => [
    index("tasks_project_idx").on(table.projectId),
    index("tasks_stage_idx").on(table.stage),
    index("tasks_activity_idx").on(table.lastActivityAt),
  ],
);

export const taskAttachments = sqliteTable("task_attachments", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  path: text("path").notNull(),
  createdAt: text("created_at").notNull(),
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    attachments: text("attachments", { mode: "json" }).notNull().default([]),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("messages_task_idx").on(table.taskId, table.createdAt)],
);

export const requirementDrafts = sqliteTable("requirement_drafts", {
  taskId: text("task_id")
    .primaryKey()
    .references(() => tasks.id, { onDelete: "cascade" }),
  content: text("content", { mode: "json" }).notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const specificationVersions = sqliteTable(
  "specification_versions",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content", { mode: "json" }).notNull(),
    approvedAt: text("approved_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("specification_version_idx").on(table.taskId, table.version)],
);

export const planVersions = sqliteTable(
  "plan_versions",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    parentVersionId: text("parent_version_id"),
    content: text("content", { mode: "json" }).notNull(),
    approvedAt: text("approved_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("plan_version_idx").on(table.taskId, table.version)],
);

export const planComments = sqliteTable("plan_comments", {
  id: text("id").primaryKey(),
  planVersionId: text("plan_version_id")
    .notNull()
    .references(() => planVersions.id, { onDelete: "cascade" }),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
});

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    sessionId: text("session_id"),
    status: text("status").notNull(),
    configSnapshot: text("config_snapshot", { mode: "json" }),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [index("agent_runs_task_idx").on(table.taskId, table.startedAt)],
);

export const agentEvents = sqliteTable(
  "agent_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("agent_events_task_idx").on(table.taskId, table.id)],
);

export const orchestrationJobs = sqliteTable(
  "orchestration_jobs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    leaseOwner: text("lease_owner"),
    leaseUntil: text("lease_until"),
    error: text("error"),
    availableAt: text("available_at").notNull(),
    ...timestamps,
  },
  (table) => [index("jobs_claim_idx").on(table.status, table.availableAt)],
);

export const taskLocks = sqliteTable("task_locks", {
  taskId: text("task_id")
    .primaryKey()
    .references(() => tasks.id, { onDelete: "cascade" }),
  owner: text("owner").notNull(),
  leaseUntil: text("lease_until").notNull(),
});

export const taskCommits = sqliteTable(
  "task_commits",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    planCommitId: text("plan_commit_id").notNull(),
    sha: text("sha").notNull(),
    message: text("message").notNull(),
    order: integer("order").notNull(),
    summary: text("summary"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("task_commit_order_idx").on(table.taskId, table.order)],
);

export const commandRuns = sqliteTable("command_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  agentRunId: text("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  deploymentId: text("deployment_id"),
  command: text("command").notNull(),
  cwd: text("cwd").notNull(),
  status: text("status").notNull(),
  exitCode: integer("exit_code"),
  pid: integer("pid"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

export const testRuns = sqliteTable("test_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  commandRunId: text("command_run_id").references(() => commandRuns.id),
  command: text("command").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull(),
  durationMs: integer("duration_ms"),
  environment: text("environment"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  runId: text("run_id"),
  type: text("type").notNull(),
  path: text("path").notNull(),
  mimeType: text("mime_type"),
  metadata: text("metadata", { mode: "json" }).notNull().default({}),
  createdAt: text("created_at").notNull(),
});

export const reviewRequests = sqliteTable(
  "review_requests",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [uniqueIndex("review_version_idx").on(table.taskId, table.version)],
);

export const reviewComments = sqliteTable("review_comments", {
  id: text("id").primaryKey(),
  reviewRequestId: text("review_request_id")
    .notNull()
    .references(() => reviewRequests.id, { onDelete: "cascade" }),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

export const deploymentConfirmations = sqliteTable("deployment_confirmations", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  recipeId: text("recipe_id").notNull(),
  recipeSnapshot: text("recipe_snapshot", { mode: "json" }).notNull(),
  commitSha: text("commit_sha").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull(),
});

export const deployments = sqliteTable("deployments", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  recipeId: text("recipe_id").notNull(),
  recipeSnapshot: text("recipe_snapshot", { mode: "json" }).notNull(),
  status: text("status").notNull(),
  commitSha: text("commit_sha").notNull(),
  resultUrl: text("result_url"),
  diagnosis: text("diagnosis"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
});

export const deploymentSteps = sqliteTable(
  "deployment_steps",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    label: text("label").notNull(),
    command: text("command"),
    status: text("status").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (table) => [uniqueIndex("deployment_step_order_idx").on(table.deploymentId, table.order)],
);

export const taskEvents = sqliteTable(
  "task_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actor: text("actor").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("task_events_task_idx").on(table.taskId, table.id)],
);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  readAt: text("read_at"),
  createdAt: text("created_at").notNull(),
});

export const migrationJournal = sqliteTable("relay_migrations", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  appliedAt: text("applied_at").notNull(),
});
