# Relay architecture

## Processes

Relay uses two independent long-running processes against one local SQLite database in WAL mode.

- **Web:** Next.js pages, authenticated route handlers, uploads, task events, and SSE.
- **Worker:** durable job claiming, Codex sessions, Git worktrees, tests, commits, and deployments.

The browser never connects to Codex. The path is always browser → Relay API → durable job → worker → Codex App Server over stdio.

## Durable work

`orchestration_jobs` records every background action with an idempotency key, attempt count, lease owner, and lease expiration. A worker reclaims expired work after a crash. A separate task lock prevents two jobs from mutating the same task concurrently. Task creation also stores a browser-generated submission key, so repeating the same form submission returns the existing task instead of creating duplicate work.

Worker startup does not reset repositories. Before continuing implementation, Relay reconciles the approved plan, current commit number, worktree status, and Git HEAD. Ambiguous or invalid states become blocked for human inspection.

The worker writes `worker-heartbeat.json` every five seconds and periodically records Codex authentication readiness. The web process treats a heartbeat older than fifteen seconds as offline and blocks task creation when the worker reports that Codex login is required.

## State machine

The server enforces these normal transitions:

```text
Refinement → Planning
Planning → Refinement | Implementation
Implementation → Review
Review → Implementation | Ready to Deploy
Ready to Deploy → Deploying | Implementation
Deploying → Done | Implementation | Ready to Deploy
Done → terminal
```

Implementation completion records `implementation.ready_for_review` and waits in Implementation until the owner moves it to Review. A successful already-confirmed deployment can move to Done automatically. Every approval before deployment and every sensitive delivery action originates from an authenticated owner request.

## Workboard phases

The owner-facing workflow groups internal states into six phases:

```text
Refine → Plan → Build → Review → Deploy → Done
```

`ready_to_deploy` and `deploying` are both shown under Deploy with distinct runtime labels. Dialog buttons and board drag-and-drop call the same validated transition service. Only the adjacent phase is accepted, active work cannot move, backward transitions remain explicit review or refinement actions, and entering Deploy never executes a recipe. Phase visits and message context are stored durably so completed and previously visited tabs remain readable after backward movement.

Agent events stream to the task dialog over SSE. Provider-supplied progress summaries, commands, output, files, tests, artifacts, and completion events are shown incrementally; Relay does not expose private chain-of-thought.

## Versions and history

Approved specifications and generated plans are immutable rows. Revisions create new rows linked to their parent. Task events, agent events, command runs, test runs, reviews, commits, artifacts, confirmations, and deployment attempts are retained separately.

## Commit boundary

For each approved plan item Relay:

1. records starting HEAD;
2. starts one implementer turn restricted to that item;
3. rejects an agent-created commit or unexpected HEAD change;
4. runs `git diff --check` and the plan's checks;
5. creates the approved Git commit itself;
6. stores the exact SHA;
7. moves to the next item.

The implementation agent has full worktree command access and no interactive approvals, but it cannot bypass Relay's state or deployment APIs.

## Storage

The default `~/.relay` structure is:

```text
relay.db
relay.db-wal
relay.db-shm
worker-heartbeat.json
uploads/<task-id>/...
artifacts/<task-id>/...
worktrees/<project-id>/<task-id>/...
```

Artifact and attachment downloads require authentication and reject paths outside the Relay data directory. Confirmed deletion is allowed only without active work; it removes the task's cascading database history, uploads, artifacts, and registered worktree while intentionally leaving the source repository and task branch intact.
