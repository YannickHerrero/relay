#!/usr/bin/env bash
set -uo pipefail

root_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
service_command="${RELAY_SERVICE_COMMAND:-$root_directory/scripts/relay-service.sh}"
tailscale_command="${RELAY_TAILSCALE_COMMAND:-$root_directory/scripts/relay-tailscale.sh}"
pnpm_command="${RELAY_PNPM_COMMAND:-$(command -v pnpm || true)}"

start_relay() {
  "$service_command" validate || return
  local was_loaded=false
  if "$service_command" is-loaded; then
    was_loaded=true
  fi
  "$service_command" start || return
  if ! "$tailscale_command" start; then
    if [[ "$was_loaded" == false ]]; then
      "$service_command" stop || true
    fi
    return 1
  fi
}

stop_relay() {
  local exit_code=0
  "$service_command" stop || exit_code=1
  "$tailscale_command" stop || exit_code=1
  return "$exit_code"
}

case "${1:-}" in
  start)
    start_relay
    ;;
  stop)
    stop_relay
    ;;
  restart)
    stop_relay && start_relay
    ;;
  rebuild-restart)
    stop_relay || exit 1
    if [[ -z "$pnpm_command" || ! -x "$pnpm_command" ]]; then
      printf 'pnpm is not installed or is not executable.\n' >&2
      exit 1
    fi
    "$pnpm_command" build || {
      printf 'Relay build failed; Relay remains stopped.\n' >&2
      exit 1
    }
    start_relay
    ;;
  *)
    printf 'Usage: %s {start|stop|restart|rebuild-restart}\n' "$0" >&2
    exit 1
    ;;
esac
