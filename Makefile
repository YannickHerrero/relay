SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help dev dev-local serve unserve serve-status check

help:
	@printf '%s\n' \
		'make dev          Configure Tailscale Serve and start Relay in development mode' \
		'make dev-local    Start Relay in development mode without changing Tailscale Serve' \
		'make serve        Configure Tailscale Serve without starting Relay' \
		'make unserve      Remove Relay from Tailscale Serve' \
		'make serve-status Show the current Tailscale Serve configuration' \
		'make check        Run formatting, linting, type checking, tests, and build'

dev: serve
	@pnpm dev

dev-local:
	@pnpm dev

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
