#!/usr/bin/env bash
set -euo pipefail

root_directory="${RELAY_ROOT_DIRECTORY:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
label="${RELAY_LAUNCHD_LABEL:-com.yannickherrero.relay}"
domain="gui/${RELAY_UID:-$(id -u)}"
launch_agents_directory="${RELAY_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
plist_path="$launch_agents_directory/$label.plist"
launchctl_command="${RELAY_LAUNCHCTL_COMMAND:-/bin/launchctl}"
plistbuddy_command="${RELAY_PLISTBUDDY_COMMAND:-/usr/libexec/PlistBuddy}"
pnpm_command="${RELAY_PNPM_COMMAND:-$(command -v pnpm || true)}"
log_directory="${RELAY_DATA_DIR:-$HOME/.relay}/logs"
stdout_path="$log_directory/service.log"
stderr_path="$log_directory/service-error.log"

service_is_loaded() {
  "$launchctl_command" print "$domain/$label" >/dev/null 2>&1
}

plist_value() {
  "$plistbuddy_command" -c "Print :$1" "$plist_path" 2>/dev/null
}

plist_is_owned() {
  [[ -f "$plist_path" ]] || return 1
  [[ "$(plist_value RelayManagedService || true)" == "true" ]] || return 1
  [[ "$(plist_value RelayRootDirectory || true)" == "$root_directory" ]]
}

assert_owned_plist() {
  if [[ -e "$plist_path" ]] && ! plist_is_owned; then
    printf 'Refusing to replace an unrelated LaunchAgent at %s.\n' "$plist_path" >&2
    return 1
  fi
}

validate_build() {
  if [[ ! -f "$root_directory/apps/web/.next/BUILD_ID" ]]; then
    printf 'Relay production build is missing. Run make rebuild-restart first.\n' >&2
    return 1
  fi
  if [[ -z "$pnpm_command" || ! -x "$pnpm_command" ]]; then
    printf 'pnpm is not installed or is not executable.\n' >&2
    return 1
  fi
}

write_plist() {
  mkdir -p "$launch_agents_directory" "$log_directory"
  chmod 700 "$log_directory"
  local temporary_path="$plist_path.tmp.$$"
  RELAY_PLIST_LABEL="$label" \
  RELAY_PLIST_ROOT="$root_directory" \
  RELAY_PLIST_PNPM="$pnpm_command" \
  RELAY_PLIST_PATH="$PATH" \
  RELAY_PLIST_STDOUT="$stdout_path" \
  RELAY_PLIST_STDERR="$stderr_path" \
    node <<'NODE' >"$temporary_path"
const escape = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");
const env = process.env;
process.stdout.write(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${escape(env.RELAY_PLIST_LABEL)}</string>
  <key>RelayManagedService</key><true/>
  <key>RelayRootDirectory</key><string>${escape(env.RELAY_PLIST_ROOT)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escape(env.RELAY_PLIST_PNPM)}</string>
    <string>run</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key><string>${escape(env.RELAY_PLIST_ROOT)}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${escape(env.RELAY_PLIST_PATH)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${escape(env.RELAY_PLIST_STDOUT)}</string>
  <key>StandardErrorPath</key><string>${escape(env.RELAY_PLIST_STDERR)}</string>
</dict>
</plist>
`);
NODE
  /usr/bin/plutil -lint "$temporary_path" >/dev/null
  chmod 600 "$temporary_path"
  mv "$temporary_path" "$plist_path"
}

case "${1:-}" in
  validate)
    assert_owned_plist
    validate_build
    ;;
  is-loaded)
    service_is_loaded
    ;;
  is-owned)
    plist_is_owned
    ;;
  start)
    assert_owned_plist
    validate_build
    if service_is_loaded; then
      printf 'Relay LaunchAgent is already loaded.\n'
      exit 0
    fi
    write_plist
    "$launchctl_command" bootstrap "$domain" "$plist_path"
    printf 'Relay LaunchAgent started.\n'
    ;;
  stop)
    assert_owned_plist
    if ! service_is_loaded; then
      printf 'Relay LaunchAgent is not running.\n'
      exit 0
    fi
    if ! plist_is_owned; then
      printf 'Refusing to stop LaunchAgent %s without its Relay-owned definition.\n' "$label" >&2
      exit 1
    fi
    "$launchctl_command" bootout "$domain/$label"
    printf 'Relay LaunchAgent stopped.\n'
    ;;
  status)
    if service_is_loaded; then
      printf 'Relay LaunchAgent: loaded\n'
    else
      printf 'Relay LaunchAgent: stopped\n'
    fi
    if plist_is_owned; then
      printf 'Definition: Relay-owned (%s)\n' "$plist_path"
    elif [[ -e "$plist_path" ]]; then
      printf 'Definition: unrelated (%s)\n' "$plist_path"
    else
      printf 'Definition: absent\n'
    fi
    ;;
  *)
    printf 'Usage: %s {validate|is-loaded|is-owned|start|stop|status}\n' "$0" >&2
    exit 1
    ;;
esac
