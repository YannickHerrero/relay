#!/usr/bin/env bash
set -euo pipefail

ROOT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${RELAY_ENV_FILE:-$ROOT_DIRECTORY/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  printf 'Relay environment file not found: %s\n' "$ENV_FILE" >&2
  printf 'Create it with: cp .env.example .env\n' >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

required_variables=(PORT RELAY_DATA_DIR RELAY_ORIGIN RELAY_CODEX_COMMAND)
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    printf 'Required Relay environment variable is empty: %s\n' "$variable_name" >&2
    exit 1
  fi
done

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || ((PORT < 1 || PORT > 65535)); then
  printf 'PORT must be an integer between 1 and 65535, received: %s\n' "$PORT" >&2
  exit 1
fi

if (($# == 0)); then
  printf 'Usage: %s <command> [arguments...]\n' "$0" >&2
  exit 1
fi

cd "$ROOT_DIRECTORY"
exec "$@"
