# Remote protocol

Version 1. Remote clients (omnitool, later native apps) connect to `[remote] listen` over a WebSocket and exchange JSON text messages. TLS comes from whatever sits in front, usually `tailscale serve`.

## Pairing

`relay remote pair` shows a QR code holding:

```json
{"name": "Mac mini", "url": "wss://mac.example.ts.net", "token": "64 hex characters"}
```

`relay remote pair --revoke` replaces the token and disconnects every client with `token revoked`.

## Hello

The first message must be:

```json
{"v": 1, "token": "…"}
```

The server answers with the state, or with `closed` and shuts the connection:

| Reason | Cause |
|---|---|
| `wrong token` | |
| `origin not allowed; add it to [remote] origins` | a browser sent an `Origin` header that is not listed |
| `this relay speaks version 1 of the protocol, not N` | |
| `the first message must be a hello` | |

The server waits 10 seconds for the hello.

## From the server

Every message has an `event` field.

**`state`**: everything, right after the hello and again whenever something changes (checked every 300 ms). Clients replace what they had.

```json
{
  "event": "state",
  "spaces": [
    {"name": "relay", "cwd": "/Users/u/dev/relay", "active": true, "workspace": 2, "windows": 3}
  ],
  "windows": [
    {
      "id": "w3",
      "space": "relay",
      "workspace": 2,
      "title": "heartbeat",
      "agent": "pi",
      "status": "working",
      "cwd": "~/dev/relay",
      "focused": false,
      "floating": false,
      "prompt": null,
      "state_since": "2026-10-02T09:41:12.204Z",
      "last_activity": "2026-10-02T09:41:40.789Z",
      "last_message": {"role": "assistant", "text": "Heartbeat added. The server now sends…", "at": "2026-10-02T09:41:40.789Z"}
    }
  ]
}
```

`agent` is `claude`, `pi` or null. `status` is `working`, `blocked` (needs you), `done` (finished, not looked at yet), `idle`, `unknown`, or null for windows without an agent. `workspace` counts from 1. `state_since` is when `status` last changed (for "Working… 12 s"). `last_activity` and `last_message` (at most 200 characters, on one line) come from the conversation and are null without one. Times are RFC 3339 in UTC.

`prompt` is set while the agent waits on a choice (`status` is `blocked`): a permission, a question, a dialog. It is read from the screen, so it follows what the agent shows; `action` is the tool call waiting for permission, from the conversation, or null. Answer by sending an option's `keys` with `send_keys`; for "Type something." send its keys, then the text with `send_text`.

```json
{
  "title": "Bash command",
  "lines": ["Remove relay test file", "rm -rf relay-test-file", "", "Do you want to proceed?"],
  "options": [
    {"label": "Yes", "keys": ["1"]},
    {"label": "No", "keys": ["2"]}
  ],
  "action": {"tool": "bash", "target": "rm -rf relay-test-file"}
}
```

Options may carry a `description`. Unnumbered options are reached with arrows: `{"label": "Yes, I trust this folder", "keys": ["Down", "Enter"]}`.

**`transcript`**: the conversation of the window the client views (see `view`). Entries from `from` on replace what the client has; earlier entries stay. A first message starts at `from` 0 or at the last 100 entries; later ones usually append, or start at the action whose result just arrived. `from` 0 with no entries means the window's agent or session changed.

```json
{"event": "transcript", "window": "w3", "from": 41, "entries": [ … ]}
```

**`reply`**: the result of a command, with the command's `id`. `result` is `{"ok": value}` or `{"error": "message"}`. A message that is not a command gets a reply with id 0.

```json
{"event": "reply", "id": 4, "result": {"ok": {"window": "w5"}}}
```

**`closed`**: the server is letting the client go; the connection closes right after.

```json
{"event": "closed", "reason": "token revoked"}
```

## Conversation entries

Conversations come from the session files Claude Code and pi write, so a window has one only while its agent runs with a known session: install the integration (`relay integration install claude` or `pi`). Thinking and subagent turns are left out.

```json
{"kind": "user", "text": "Ping every 15 s", "at": "…"}
{"kind": "assistant", "text": "Markdown text", "at": "…"}
{
  "kind": "action",
  "id": "toolu_01…",
  "tool": "edit",
  "target": "src/protocol.rs",
  "status": "ok",
  "at": "…",
  "diff": {
    "added": 12,
    "removed": 3,
    "truncated": false,
    "hunks": [{"old_start": 38, "new_start": 38, "lines": [" Output {", "-Close { pane: u32 },", "+Close { pane: u32, code: u16 },"]}]
  }
}
{"kind": "action", "id": "…", "tool": "bash", "target": "cargo test", "status": "error", "at": "…", "output": "last 40 lines"}
```

`tool` is the agent's tool name in lowercase (`read`, `edit`, `write`, `bash`, `grep`…). `target` is what it works on: a path relative to the session's directory, the first line of a command, a pattern. `status` is `running` until the result arrives, then `ok` or `error`. Edits and writes carry a `diff` (at most 400 lines, `added` and `removed` count them all); commands carry the end of their `output`, as do failed tools.

## Commands

A command is an `id` chosen by the client and a `method` with its fields.

| Method | Fields | Ok value |
|---|---|---|
| `status` | | `{"version", "attached", "spaces", "windows"}` |
| `list_spaces` | | the `spaces` of `state` |
| `list_windows` | | the `windows` of `state` |
| `open_space` | `path`, `name` (optional) | `{"space"}`; focuses or creates the space of a directory |
| `run` | `command`, `space`, `workspace` (1 to 9), `float` (all optional but `command`) | `{"window"}`; types the command in a new shell |
| `send_text` | `window`, `text` | null; end `text` with `\r` to press Enter |
| `send_keys` | `window`, `keys` | null; keys are chords like `Enter`, `Esc`, `Down`, `Ctrl+C`, `1` |
| `view` | `window`, or null to stop | `{"total"}`; follows the window's conversation with `transcript` messages. While a client views a window, its agent's news counts as seen: `done` becomes `idle` |
| `read_screen` | `window` | `{"lines"}`: the window's screen as text, for windows without a conversation |
| `transcript` | `window`, `before`, `limit` (both optional) | `{"from", "total", "entries"}`: up to `limit` entries (100, at most 500) before index `before` (the end), to scroll back |

```json
{"id": 4, "method": "send_keys", "window": "w3", "keys": ["Down", "Enter"]}
```

Server control (stopping it, reloading config, pairing) and agent hooks are refused with `not available to remote clients`.
