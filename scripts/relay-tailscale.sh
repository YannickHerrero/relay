#!/usr/bin/env bash
set -euo pipefail

if ! command -v tailscale >/dev/null 2>&1; then
  printf 'Tailscale CLI is not installed or is not on PATH.\n' >&2
  exit 1
fi

if [[ "${RELAY_ORIGIN:-}" != https://* ]]; then
  printf 'RELAY_ORIGIN must be the HTTPS Tailscale URL before configuring Serve.\n' >&2
  exit 1
fi

origin_host="$(
  node -e '
    const origin = new URL(process.argv[1]);
    if (origin.protocol !== "https:" || origin.port || origin.pathname !== "/" || origin.search || origin.hash) {
      process.exit(1);
    }
    process.stdout.write(origin.hostname);
  ' "$RELAY_ORIGIN"
)" || {
  printf 'RELAY_ORIGIN must be an HTTPS origin without a port, path, query, or fragment.\n' >&2
  exit 1
}

tailscale_host="$(
  tailscale status --json | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (input += chunk));
    process.stdin.on("end", () => {
      const dnsName = JSON.parse(input).Self?.DNSName?.replace(/\.$/, "");
      if (!dnsName) process.exit(1);
      process.stdout.write(dnsName);
    });
  '
)" || {
  printf 'Unable to determine this device’s Tailscale DNS name.\n' >&2
  exit 1
}

if [[ "$origin_host" != "$tailscale_host" ]]; then
  printf 'RELAY_ORIGIN host %s does not match this device’s Tailscale DNS name %s.\n' \
    "$origin_host" "$tailscale_host" >&2
  exit 1
fi

target="http://127.0.0.1:${PORT}"

serve_config() {
  tailscale serve status --json
}

config_is_empty() {
  CONFIG_JSON="$1" node -e '
    const config = JSON.parse(process.env.CONFIG_JSON);
    process.exit(Object.keys(config).length === 0 ? 0 : 1);
  '
}

config_is_relay_only() {
  CONFIG_JSON="$1" RELAY_HOST="$origin_host" RELAY_TARGET="$target" node -e '
    const config = JSON.parse(process.env.CONFIG_JSON);
    const expected = {
      TCP: { "443": { HTTPS: true } },
      Web: {
        [`${process.env.RELAY_HOST}:443`]: {
          Handlers: { "/": { Proxy: process.env.RELAY_TARGET } },
        },
      },
    };
    const normalize = (value) => {
      if (Array.isArray(value)) return value.map(normalize);
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => [key, normalize(child)]),
        );
      }
      return value;
    };
    process.exit(JSON.stringify(normalize(config)) === JSON.stringify(normalize(expected)) ? 0 : 1);
  '
}

show_conflict() {
  printf 'Refusing to modify an unrelated Tailscale Serve configuration.\n' >&2
  tailscale serve status >&2
}

case "${1:-}" in
  start)
    config="$(serve_config)"
    if config_is_relay_only "$config"; then
      printf 'Relay is already exposed at %s\n' "$RELAY_ORIGIN"
      exit 0
    fi
    if ! config_is_empty "$config"; then
      show_conflict
      exit 1
    fi
    tailscale serve --bg --yes "$target"
    printf 'Relay is available within your tailnet at %s\n' "$RELAY_ORIGIN"
    ;;
  stop)
    config="$(serve_config)"
    if config_is_empty "$config"; then
      printf 'No Tailscale Serve configuration is active.\n'
      exit 0
    fi
    if ! config_is_relay_only "$config"; then
      show_conflict
      exit 1
    fi
    tailscale serve --https=443 off
    printf 'Relay Tailscale Serve configuration removed.\n'
    ;;
  status)
    tailscale serve status
    ;;
  status-json)
    config="$(serve_config)"
    state="conflict"
    if config_is_relay_only "$config"; then
      state="active"
    elif config_is_empty "$config"; then
      state="inactive"
    fi
    RELAY_SERVE_STATE="$state" RELAY_SERVE_ORIGIN="$RELAY_ORIGIN" RELAY_SERVE_TARGET="$target" node -e '
      process.stdout.write(JSON.stringify({
        state: process.env.RELAY_SERVE_STATE,
        origin: process.env.RELAY_SERVE_ORIGIN,
        target: process.env.RELAY_SERVE_TARGET,
      }));
    '
    ;;
  *)
    printf 'Usage: %s {start|stop|status|status-json}\n' "$0" >&2
    exit 1
    ;;
esac
