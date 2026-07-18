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
pnpm build
set -a; source .env; set +a
pnpm start
```

Open `http://localhost:3000`, create the single owner password, and register a Git repository.

Authenticate Codex under the same macOS account before starting real agent work:

```bash
pnpm --filter @relay/agent exec codex login
pnpm --filter @relay/agent exec codex --version
```

Relay stores its database, uploads, artifacts, and worktrees under `~/.relay` by default. Nothing in that directory belongs in this repository.

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
pnpm dev
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
