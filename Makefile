SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help dev dev-local start stop restart rebuild-restart status status-json serve unserve serve-status check

help:
	@printf '%s\n' \
		'make dev             Configure Tailscale Serve and start Relay in development mode' \
		'make dev-local       Start Relay in development mode without changing Tailscale Serve' \
		'make start           Start production Relay and Tailscale Serve with launchd' \
		'make stop            Stop production Relay and remove its Tailscale Serve configuration' \
		'make restart         Restart production Relay and Tailscale Serve' \
		'make rebuild-restart Rebuild, then restart production Relay and Tailscale Serve' \
		'make status          Show Relay, worker, launchd, and Tailscale status' \
		'make serve           Configure Tailscale Serve without starting Relay' \
		'make unserve         Remove Relay from Tailscale Serve' \
		'make serve-status    Show the current Tailscale Serve configuration' \
		'make check           Run formatting, linting, type checking, tests, and build'

dev: serve
	@pnpm dev

dev-local:
	@pnpm dev

start:
	@./scripts/with-relay-env.sh ./scripts/relay-control.sh start

stop:
	@./scripts/with-relay-env.sh ./scripts/relay-control.sh stop

restart:
	@./scripts/with-relay-env.sh ./scripts/relay-control.sh restart

rebuild-restart:
	@./scripts/with-relay-env.sh ./scripts/relay-control.sh rebuild-restart

status:
	@./scripts/with-relay-env.sh node ./scripts/relay-status.mjs

status-json:
	@./scripts/with-relay-env.sh node ./scripts/relay-status.mjs --json

serve:
	@./scripts/with-relay-env.sh ./scripts/relay-tailscale.sh start

unserve:
	@./scripts/with-relay-env.sh ./scripts/relay-tailscale.sh stop

serve-status:
	@./scripts/with-relay-env.sh ./scripts/relay-tailscale.sh status

check:
	@pnpm format:check
	@pnpm lint
	@pnpm typecheck
	@pnpm test
	@pnpm build
