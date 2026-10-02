# relay

A terminal multiplexer that behaves like a tiling window manager, built to run and watch coding agents (Claude Code, pi). Windows tile in a fibonacci spiral, live in nine workspaces per space, and show what their agent is doing.

A background server owns every terminal, so closing the client or losing the terminal leaves the agents running. After a restart, the layout comes back and Claude Code and pi sessions resume.

## Install

```sh
cargo install --path .
relay
```

`relay` attaches to the server, starting it first if needed. Detach with `Ctrl+B x d`; running `relay` again reattaches.

## Concepts

| relay | What it is |
|---|---|
| Space | One per project, with its own nine workspaces |
| Workspace | 1 to 9, a screen of windows |
| Window | A terminal; tiled automatically, or floating |

The first window of a workspace takes the left half; each new one splits what remains, alternating vertical and horizontal cuts.

## Keys

The main modifier `Mod` is `Ctrl` by default (`modifier = "alt"` or `"meta"` in `config.toml`). Only a few chords are direct, so shells and agents keep their keys.

| Key | Action |
|---|---|
| Mod+H/J/K/L | Focus left, down, up, right |
| Mod+Shift+H/J/K/L | Swap with the neighbor (needs a terminal that tells Ctrl+Shift+letter from Ctrl+letter) |
| Mod+1…9 | Workspace 1 to 9 |
| Mod+Space | Palette (also Ctrl+B Space) |
| Mod+Q | Close the window |

Everything else goes through the leader, `Ctrl+B`, whose menu lists the keys at each step. It stays open until a key is chosen: Escape cancels, Backspace goes back to the root, `Ctrl+B Ctrl+B` sends `Ctrl+B` to the window.

| After Ctrl+B | Action |
|---|---|
| Enter | New terminal |
| q | Close the window |
| , | Name the window; only named windows show a title (empty name removes it) |
| w | Rename the workspace, shown as `3 - name` in the bar (empty name restores the number) |
| f | Fullscreen |
| t | Float / tile |
| h j k l | Focus |
| H J K L | Swap with the neighbor |
| r | Resize mode: h / l width, j / k height (or arrows), Escape to leave |
| 1…9 | Workspace |
| s | Agents sidebar |
| Tab | Recent workspace |
| d | Agents dashboard |
| m, 1…9 | Move the window to a workspace and follow it |
| o | Space picker |
| n / p | Next / previous workspace |
| Shift+Tab | Recent space |
| ? | Keybindings |
| x d / x r / x q | Detach / reload config / stop the server |

## Mouse

- Click a window to focus it, a workspace in the bar to show it, the space name to pick a space.
- Drag a title bar: the window follows the pointer, even past the screen edges, and swaps with the window it is dropped on; drag a floating window by its title to move it, by its border to resize it.
- Drag the border between two tiled windows to move the split.
- The three dots in a title bar float, zoom and close the window.
- Right-click a window (new terminal, fullscreen, float, rename, move, close) or a workspace (go to, rename, move the focused window there) for a menu.
- The wheel scrolls back through history; typing returns to the bottom.
- Drag to select, double-click for a word, triple-click for a line. The selection is copied to the clipboard through OSC 52 when the button is released, and a notification confirms it.

Programs that ask for the mouse (lazygit, vim) get it; hold Shift to select or open the menu anyway.

## Palette

`Mod+Space` searches windows of every space, spaces, project directories, programs and actions. Choosing a project focuses its space, or creates it with a terminal there. `@w`, `@b`, `@d`, `@i` and `@a` keep only windows whose agent is working, blocked, done, idle, or needs attention.

## Agents

Each window running Claude Code or pi shows a badge: **working**, **needs you**, **done** (finished while you looked elsewhere) or **idle**. The bar counts them; a window waiting for an answer gets an orange border.

`Ctrl+B s` slides in the agents sidebar on the right, as in herdr: one row per agent with its state (yellow working, red needs you, teal done, green idle), its space, its workspace when the space has several, and its name. Click a row to jump to it; `»` closes the sidebar. It stays open across restarts.

`Ctrl+B d` opens the agents dashboard: every agent of every space, in the order they started. `j` / `k` select, Enter jumps to the agent's window, Tab switches between all spaces and the current one (remembered across restarts).

State is read from the screen with herdr's detection rules. Integrations add more:

```sh
relay integration install claude   # session id, to resume after a restart
relay integration install pi       # session and exact working / blocked / idle state
```

The Claude integration adds a `SessionStart` hook to `~/.claude/settings.json` and keeps a backup next to it. The pi one writes an extension to `~/.pi/agent/extensions/`.

## Command line

```sh
relay open ~/dev/project        # focus or create the project's space
relay run --workspace 2 -- claude
relay run --float -- lazygit
relay send w3 "npm test" --enter
relay send-keys w3 Down Enter   # keys as in keybindings: Esc, Ctrl+C...
relay windows                   # JSON, with agent states
relay events                    # spaces and windows as a JSON line, again on every change
relay remote pair               # pair a phone, see Remote access
relay spaces
relay status
relay reload
relay stop
```

Windows get `RELAY=1`, `RELAY_WINDOW_ID`, `RELAY_SOCKET` and `RELAY_BIN` in their environment.

## Configuration

`~/.config/relay/config.toml`:

```toml
modifier = "ctrl"          # ctrl, alt or meta
leader = "Ctrl+B"
motion = "full"            # none, basic (slides) or full (and fades, shimmer)
shell = ""                 # empty means $SHELL

[projects]
roots = ["~/dev"]

[programs]
claude = "claude"
pi = "pi"
lazygit = "lazygit"
```

`~/.config/relay/keybindings.toml` overrides or adds bindings with Illium's syntax. An empty command unbinds a key.

```toml
[keybindings]
"Mod+Space" = "palette toggle"
"Leader g" = "popup lazygit"
"Leader c" = "spawn claude"
"Leader Shift+Tab" = ""
```

Both files reload when saved. Commands: `window focus|move left|right|up|down`, `window resize --width|--height ±N%`, `window resize-mode`, `window toggle-fullscreen`, `window toggle-float`, `window set-tiling`, `window close`, `window rename`, `window move-workspace N [--follow]`, `workspace N`, `workspace next|prev|next-active`, `workspace rename`, `workspace recent`, `space next|recent|picker`, `spawn <program>`, `popup <command>`, `palette toggle`, `keybindings toggle`, `agents toggle`, `sidebar toggle`, `client detach`, `config reload`, `server stop`.

## State

The server keeps its socket, log and `state.json` in `~/.local/state/relay/`. Processes do not survive a server restart: windows come back as shells in their last directory, and agents with a known session are resumed (`claude --resume`, `pi --session`). Delete `state.json` to start from scratch.

## Remote access

Phones and tablets follow and answer agents through omnitool, a web app that talks to the server over a WebSocket. It is off until `config.toml` has a `[remote]` section:

```toml
[remote]
listen = "127.0.0.1:7777"                  # read when the server starts
url = "wss://mac.example.ts.net"           # where devices reach it
name = "Mac mini"                          # optional, defaults to the host name
origins = ["https://omnitool.vercel.app"]  # web apps allowed to connect
```

Keep `listen` on loopback and let Tailscale add TLS and keep it inside the tailnet:

```sh
tailscale serve --bg 7777
relay remote pair            # QR code to scan in omnitool, and the same as text
relay remote pair --revoke   # new token; every paired device must pair again
```

The token lives in `~/.local/state/relay/remote-token`. Anyone holding it can type into every window, so treat it like an SSH key. Browsers must come from one of `origins`; clients that send no origin only need the token. The protocol is described in [docs/remote-protocol.md](docs/remote-protocol.md).

## Running as a service

On a machine used as a server, start relay at login so agents keep running without anyone attached. `relay server` runs in the foreground and exits cleanly on `relay stop`; the services below restart it only after a crash. Clients find it through its socket as usual.

macOS, `~/Library/LaunchAgents/dev.relay.server.plist` (launchd does not expand `~`, write full paths):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.relay.server</string>
  <key>ProgramArguments</key>
  <array><string>/Users/you/.cargo/bin/relay</string><string>server</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>/Users/you/.local/state/relay/server.log</string>
  <key>StandardErrorPath</key><string>/Users/you/.local/state/relay/server.log</string>
</dict>
</plist>
```

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.relay.server.plist
```

A LaunchAgent runs in the user's login session, so agents can read the keychain, where Claude Code keeps its login. A server started from an SSH session may not; on a headless Mac, enable automatic login and let launchd start it.

Linux and WSL with systemd, `~/.config/systemd/user/relay.service`:

```ini
[Unit]
Description=relay server

[Service]
ExecStart=%h/.cargo/bin/relay server
Restart=on-failure

[Install]
WantedBy=default.target
```

```sh
systemctl --user enable --now relay
loginctl enable-linger $USER   # keep it running with no session open
```

WSL needs `systemd=true` under `[boot]` in `/etc/wsl.conf`.

## Credits

- The terminal core, agent detection rules and integrations follow [herdr](https://github.com/herdrdev/herdr) (Apache-2.0). `src/detect/manifests/*.toml` are copied from it; `src/integration/relay-agent-state.ts` is adapted from its pi extension.
- The window look, animations and palette take after [tuios](https://github.com/Gaurav-Gosain/tuios).
- Concepts and keys come from Illium.
- Terminal emulation is [alacritty_terminal](https://github.com/alacritty/alacritty).

## License

relay is licensed under the [Apache License 2.0](LICENSE).
