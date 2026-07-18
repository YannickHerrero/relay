import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

export type RelayDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(filename: string) {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const sqlite = new BetterSqlite3(filename);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  if (filename !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = NORMAL");
  }

  migrate(sqlite);
  const db = drizzle(sqlite, { schema });

  return { db, sqlite };
}

const migrations = [
  {
    id: 1,
    name: "initial",
    sql: `
CREATE TABLE IF NOT EXISTS relay_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE users (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
CREATE UNIQUE INDEX sessions_token_hash_idx ON sessions(token_hash);
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, repository_path TEXT NOT NULL UNIQUE, default_branch TEXT NOT NULL, project_type TEXT NOT NULL, archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE project_config_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, version INTEGER NOT NULL, source TEXT NOT NULL, hash TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX project_config_version_idx ON project_config_versions(project_id, version);
CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, initial_request TEXT NOT NULL, type TEXT NOT NULL, priority TEXT NOT NULL, stage TEXT NOT NULL, runtime_status TEXT NOT NULL, base_branch TEXT NOT NULL, task_branch TEXT, worktree_path TEXT, active_specification_version_id TEXT, active_plan_version_id TEXT, current_plan_commit INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, blocked_reason TEXT, last_activity_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX tasks_project_idx ON tasks(project_id); CREATE INDEX tasks_stage_idx ON tasks(stage); CREATE INDEX tasks_activity_idx ON tasks(last_activity_at);
CREATE TABLE task_attachments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, type TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE messages (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, attachments TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);
CREATE INDEX messages_task_idx ON messages(task_id, created_at);
CREATE TABLE requirement_drafts (task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE, content TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE specification_versions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, version INTEGER NOT NULL, content TEXT NOT NULL, approved_at TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX specification_version_idx ON specification_versions(task_id, version);
CREATE TABLE plan_versions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, version INTEGER NOT NULL, parent_version_id TEXT, content TEXT NOT NULL, approved_at TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX plan_version_idx ON plan_versions(task_id, version);
CREATE TABLE plan_comments (id TEXT PRIMARY KEY, plan_version_id TEXT NOT NULL REFERENCES plan_versions(id) ON DELETE CASCADE, target_type TEXT NOT NULL, target_id TEXT, content TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT);
CREATE TABLE agent_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, role TEXT NOT NULL, session_id TEXT, status TEXT NOT NULL, config_snapshot TEXT, started_at TEXT NOT NULL, completed_at TEXT);
CREATE INDEX agent_runs_task_idx ON agent_runs(task_id, started_at);
CREATE TABLE agent_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX agent_events_task_idx ON agent_events(task_id, id);
CREATE TABLE orchestration_jobs (id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, idempotency_key TEXT NOT NULL UNIQUE, lease_owner TEXT, lease_until TEXT, error TEXT, available_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX jobs_claim_idx ON orchestration_jobs(status, available_at);
CREATE TABLE task_locks (task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE, owner TEXT NOT NULL, lease_until TEXT NOT NULL);
CREATE TABLE task_commits (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, plan_commit_id TEXT NOT NULL, sha TEXT NOT NULL, message TEXT NOT NULL, "order" INTEGER NOT NULL, summary TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX task_commit_order_idx ON task_commits(task_id, "order");
CREATE TABLE command_runs (id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL, deployment_id TEXT, command TEXT NOT NULL, cwd TEXT NOT NULL, status TEXT NOT NULL, exit_code INTEGER, pid INTEGER, started_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE test_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, command_run_id TEXT REFERENCES command_runs(id), command TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL, duration_ms INTEGER, environment TEXT, started_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE artifacts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, run_id TEXT, type TEXT NOT NULL, path TEXT NOT NULL, mime_type TEXT, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE review_requests (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, version INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT);
CREATE UNIQUE INDEX review_version_idx ON review_requests(task_id, version);
CREATE TABLE review_comments (id TEXT PRIMARY KEY, review_request_id TEXT NOT NULL REFERENCES review_requests(id) ON DELETE CASCADE, target_type TEXT NOT NULL, target_id TEXT, content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE deployments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, recipe_id TEXT NOT NULL, recipe_snapshot TEXT NOT NULL, status TEXT NOT NULL, commit_sha TEXT NOT NULL, result_url TEXT, diagnosis TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE deployment_steps (id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE, "order" INTEGER NOT NULL, label TEXT NOT NULL, command TEXT, status TEXT NOT NULL, started_at TEXT, completed_at TEXT);
CREATE UNIQUE INDEX deployment_step_order_idx ON deployment_steps(deployment_id, "order");
CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, type TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX task_events_task_idx ON task_events(task_id, id);
CREATE TABLE notifications (id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL);
`,
  },
] as const;

function migrate(sqlite: BetterSqlite3.Database): void {
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS relay_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    sqlite
      .prepare("SELECT id FROM relay_migrations")
      .all()
      .map((row) => (row as { id: number }).id),
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    sqlite.transaction(() => {
      sqlite.exec(migration.sql);
      sqlite
        .prepare("INSERT INTO relay_migrations (id, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.id, migration.name, new Date().toISOString());
    })();
  }
}
