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

## Production processes with PM2

Build first, export the environment, and start both process definitions:

```bash
pnpm install --frozen-lockfile
pnpm build
npm install --global pm2
set -a; source .env; set +a
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Inspect health and logs:

```bash
pm2 status
pm2 logs relay-web
pm2 logs relay-worker
```

Relay's top bar reports the durable worker offline after a stale heartbeat.

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
- **Failed deployment:** retry explicitly against the same SHA, cancel back to Ready to Deploy, or return to Implementation for a code fix.
- **Stale process:** inspect PM2, then terminate the process group before restarting the worker.
- **Codex authentication:** run `pnpm --filter @relay/agent exec codex login` as the Relay macOS account.
- **Owner login blocked:** wait for the fifteen-minute block to expire. If local recovery is necessary, verify that the attempts were yours and clear only the owner limiter with `sqlite3 "$RELAY_DATA_DIR/relay.db" "DELETE FROM login_rate_limits WHERE key = 'owner-login';"`.

Relay never automatically retries a sensitive deployment action after a worker restart.
