# Relay operations

## Environment

```bash
RELAY_DATA_DIR=$HOME/.relay
RELAY_ORIGIN=https://relay.<tailnet>.ts.net
RELAY_CODEX_COMMAND=codex
RELAY_WORKER_CONCURRENCY=2
RELAY_SECURE_COOKIES=true
```

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

## Tailscale

Keep Next.js bound to localhost, then expose it privately:

```bash
sudo tailscale serve --bg http://127.0.0.1:3000
```

Use the HTTPS URL shown by `tailscale serve status` as `RELAY_ORIGIN`. Confirm that secure cookies are enabled before relying on remote access.

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

Relay never automatically retries a sensitive deployment action after a worker restart.
