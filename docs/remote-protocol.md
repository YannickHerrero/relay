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
      "floating": false
    }
  ]
}
```

`agent` is `claude`, `pi` or null. `status` is `working`, `blocked` (needs you), `done` (finished, not looked at yet), `idle`, `unknown`, or null for windows without an agent. `workspace` counts from 1.

**`reply`**: the result of a command, with the command's `id`. `result` is `{"ok": value}` or `{"error": "message"}`. A message that is not a command gets a reply with id 0.

```json
{"event": "reply", "id": 4, "result": {"ok": {"window": "w5"}}}
```

**`closed`**: the server is letting the client go; the connection closes right after.

```json
{"event": "closed", "reason": "token revoked"}
```

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
| `view` | `window` | null; the user is looking at the window, so `done` becomes `idle` |

```json
{"id": 4, "method": "send_keys", "window": "w3", "keys": ["Down", "Enter"]}
```

Server control (stopping it, reloading config, pairing) and agent hooks are refused with `not available to remote clients`.
