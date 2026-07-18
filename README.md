# Relay

Relay is a self-hosted web application for managing autonomous coding agents through a controlled Kanban delivery workflow. It runs on a Mac, stores its state locally in SQLite, and is designed to be reached privately over Tailscale from a desktop, iPad, or phone.

Relay keeps one task record from a vague request through:

1. requirement refinement;
2. approved specification;
3. commit-by-commit technical planning;
4. autonomous implementation in an isolated Git worktree;
5. human review;
6. explicit deployment;
7. complete archived history.

Agents may inspect repositories, edit files, run commands, use development tools, and collect evidence. Relay owns every state transition and commit boundary. An agent can never push or deploy by itself.

The Workboard presents six consistent phases: **Refine → Plan → Build → Review → Deploy → Done**. Cards open in a large board dialog with one conversation tab per phase, a live coding-agent work log, and the complete Activity & status rail. Completed phases remain readable, future phases stay disabled, and eligible cards can be dragged only to their immediate next phase. Dragging uses the same server validation as the dialog action and never starts a deployment.

## Stack

- Next.js, React, TypeScript, Tailwind CSS
- SQLite, Drizzle ORM
- Codex App Server over local stdio
- Git worktrees
- pnpm workspace
- SSE for task events
- A separate durable worker process

## Requirements

- macOS with Git and the required project toolchains
- Node.js 22 or newer
- pnpm 11
- Codex credentials for the macOS account running Relay
- Tailscale for private remote access

A dedicated local macOS account is strongly recommended. See [`docs/security.md`](docs/security.md).

## Quick start

```bash
pnpm install
cp .env.example .env
make dev-local
```

Relay reads `.env` automatically. Open the `RELAY_ORIGIN` address, create the single owner password, and register a Git repository. To expose development privately through Tailscale, set `RELAY_ORIGIN` to this Mac's Tailscale HTTPS URL, enable secure cookies, and run:

```bash
make dev
```

Use `make unserve` when Relay should no longer be available through Tailscale.

Authenticate Codex under the same macOS account before starting real agent work:

```bash
pnpm --filter @relay/agent exec codex login
pnpm --filter @relay/agent exec codex --version
```

Relay stores its database, uploads, artifacts, and worktrees under `~/.relay` by default. Nothing in that directory belongs in this repository.

## Project discovery and creation

Set `RELAY_PROJECTS_DIR` to the parent folder that contains your repositories; it defaults to `~/dev`. The **Projects** screen scans each immediate visible folder, identifies Git repositories and common project types, and shows whether it is registered. Hidden directories, nested folders, and symlinks are not traversed.

Register an existing discovered Git repository from its card. **Create project** creates one new folder under the configured root, initializes the selected branch, adds `README.md`, creates an initial commit with Relay's local Git identity, and registers the repository. Relay rejects absolute paths, traversal, duplicate folder names, and invalid branch names.

## Project configuration

A registered repository can define `.relay/project.config.ts`:

```ts
export default {
  commands: {
    setup: ["pnpm install"],
    lint: ["pnpm lint"],
    typecheck: ["pnpm typecheck"],
    unitTests: ["pnpm test"],
    build: ["pnpm build"],
    finalValidation: ["pnpm lint", "pnpm typecheck", "pnpm test", "pnpm build"],
  },
  deploymentRecipes: [
    {
      id: "git-push",
      label: "Push reviewed branch",
      kind: "git_push",
      environment: "GitHub",
      requiresConfirmation: true,
    },
  ],
};
```

Configuration is validated and versioned when a project is registered or refreshed. Every implementation run stores its configuration snapshot. See [`docs/configuration.md`](docs/configuration.md).

## Development

```bash
make dev          # Load .env, configure Tailscale Serve, and start web + worker
make dev-local    # Load .env and start web + worker locally
make serve-status
make unserve
make check
```

`pnpm dev` and `pnpm start` also load `.env` automatically, but do not change Tailscale Serve. Run the individual verification commands when needed:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

The end-to-end suite uses an isolated `.relay-e2e-data` directory and a temporary owner account. It never starts a real coding agent or sensitive deployment.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — process, persistence, state, and recovery design
- [`docs/configuration.md`](docs/configuration.md) — project commands and recipes
- [`docs/operations.md`](docs/operations.md) — PM2, backups, Tailscale, and troubleshooting
- [`docs/security.md`](docs/security.md) — account isolation, credentials, and trust boundaries

## V1 boundaries

Relay V1 supports Codex and one owner on one Mac. OpenCode/Pi adapters, native clients, native push notifications, multi-user collaboration, multi-Mac orchestration, cost analytics, and advanced diff editing are intentionally out of scope.
