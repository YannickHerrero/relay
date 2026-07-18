# Relay operations

## Environment

```bash
PORT=43127
RELAY_DATA_DIR=$HOME/.relay
RELAY_PROJECTS_DIR=$HOME/dev
RELAY_ORIGIN=https://relay.<tailnet>.ts.net
RELAY_CODEX_COMMAND=codex
RELAY_WORKER_CONCURRENCY=2
RELAY_SECURE_COOKIES=true
```

`pnpm dev` and `pnpm start` load the root `.env` file automatically. `RELAY_ORIGIN` must exactly match the address used in the browser. `RELAY_PROJECTS_DIR` is the only root Relay scans for existing repositories or uses for newly created project folders.

Optional command timeout values are milliseconds:

```bash
RELAY_COMMAND_TIMEOUT_MS=1800000
RELAY_DEPLOYMENT_TIMEOUT_MS=3600000
```

## Production processes with launchd

Build and start Relay as a user LaunchAgent together with its Tailscale Serve configuration:

```bash
pnpm install --frozen-lockfile
pnpm build
make start
```

The LaunchAgent keeps the web and worker processes alive after the terminal closes. Its Relay-owned definition is written to `~/Library/LaunchAgents/com.yannickherrero.relay.plist`, and output is written beneath `~/.relay/logs/` by default.

Use the lifecycle and health commands from any terminal:

```bash
make status          # Human-readable web, worker, launchd, and Serve status
make status-json     # Stable machine-readable status for Relay Companion
make restart         # Restart the existing production build
make rebuild-restart # Stop, rebuild, and start production
make stop            # Stop production and remove Relay's Serve configuration
```

`make start` reports that a build is required when `apps/web/.next/BUILD_ID` is absent. It never falls back to development mode. `make stop` unloads only the Relay-owned LaunchAgent and removes only the exact Relay Serve configuration. An unrelated plist, launchd job, or Serve configuration causes a safe failure instead of being replaced or terminated. A process using Relay's port outside the LaunchAgent is reported as **Running outside Companion** and is not killed.

PM2 remains an optional alternative through `ecosystem.config.cjs`, but do not run PM2 and the Relay LaunchAgent at the same time. Relay's top bar reports the durable worker offline after a stale heartbeat.

## Tailscale development

Set `RELAY_ORIGIN` to the HTTPS URL for the current Mac and set `RELAY_SECURE_COOKIES=true`. Then start both Relay processes and Tailscale Serve with one command:

```bash
make dev
```

The web process remains bound to `127.0.0.1`; Tailscale is the only remote entry point. The Make targets are also available separately:

```bash
make dev-local     # Start Relay without changing Serve
make serve         # Configure Serve only
make serve-status  # Inspect the active configuration
make unserve       # Remove Relay's Serve configuration
```

`make serve` is idempotent and refuses to replace a configuration it did not create. Tailscale Serve remains active after the development process stops, so run `make unserve` when remote access is no longer needed. Use the HTTPS URL shown by `make serve-status` in the browser.

## Backups

Stop both processes before a filesystem-level backup, or use SQLite's online backup command:

```bash
sqlite3 "$RELAY_DATA_DIR/relay.db" ".backup '$HOME/relay-backups/relay-$(date +%F).db'"
rsync -a "$RELAY_DATA_DIR/artifacts/" "$HOME/relay-backups/artifacts/"
rsync -a "$RELAY_DATA_DIR/uploads/" "$HOME/relay-backups/uploads/"
```

Git worktrees can be recreated from task branches, but uncommitted interrupted work should be retained until reviewed.

## Recovery

- **Worker restart:** expired jobs are reclaimed; work resumes at the last persisted commit boundary.
- **Stopped task:** use **Resume agent**. Existing uncommitted work is inspected and continued.
- **Blocked task:** inspect logs, diff, and the recorded reason before resuming.
- **Failed task:** correct the reported cause, then use **Retry task**. Relay queues only the most recent failed non-deployment operation with its original payload; deployment retries remain behind their dedicated SHA-bound confirmation flow.
- **Ready implementation:** use **Move to review** or drag the card from Build to Review after validation finishes. Relay no longer advances this owner gate automatically.
- **Failed deployment:** retry explicitly against the same SHA, cancel back to the ready state in Deploy, or return to Build for a code fix.
- **Task deletion:** stop active work first, open the task dialog, choose **Delete**, review the consequences, and confirm. Relay deletes task records, uploads, artifacts, and its worktree while preserving the source repository and task branch.
- **Stale production process:** run `make status`, inspect `~/.relay/logs/service.log` and `service-error.log`, then use `make restart`. Relay refuses to terminate a process using its port when the Relay-owned LaunchAgent is not loaded.
- **Codex authentication:** run `codex login --device-auth` as the Relay macOS account, then verify `codex login status`. Worker health reports when authentication is missing and Relay blocks new tasks until it is restored.
- **Owner login blocked:** wait for the fifteen-minute block to expire. If local recovery is necessary, verify that the attempts were yours and clear only the owner limiter with `sqlite3 "$RELAY_DATA_DIR/relay.db" "DELETE FROM login_rate_limits WHERE key = 'owner-login';"`.

Relay never automatically retries a sensitive deployment action after a worker restart.
