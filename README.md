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
| Mod+1…9 | Workspace 1 to 9 |
| Mod+P | Palette |

Everything else goes through the leader, `Ctrl+B`, whose menu lists the keys at each step. It stays open until a key is chosen: Escape cancels, Backspace goes back to the root, `Ctrl+B Ctrl+B` sends `Ctrl+B` to the window. Resize keys keep it open so they can repeat.

| After Ctrl+B | Action |
|---|---|
| Enter | New terminal |
| q | Close the window |
| f | Fullscreen |
| t | Float / tile |
| h j k l | Focus |
| H J K L | Swap with the neighbor |
| u / p | Width −5% / +5% |
| i / o | Height −5% / +5% |
| 1…9 | Workspace |
| s / d | Next occupied / recent workspace |
| m, 1…9 | Move the window to a workspace and follow it |
| S | Space picker |
| Tab / n | Recent / next space |
| ? | Keybindings |
| x d / x r / x q | Detach / reload config / stop the server |

## Mouse

- Click a window to focus it, a workspace in the bar to show it, the space name to pick a space.
- Drag a title bar onto another window to swap them; drag a floating window by its title to move it, by its border to resize it.
- Drag the border between two tiled windows to move the split.
- The three dots in a title bar float, zoom and close the window.
- Right-click a window or a workspace for a menu.
- The wheel scrolls back through history; typing returns to the bottom.
- Drag to select, double-click for a word, triple-click for a line. The selection is copied to the clipboard through OSC 52.

Programs that ask for the mouse (lazygit, vim) get it; hold Shift to select or open the menu anyway.

## Palette

`Mod+P` searches windows of every space, spaces, project directories, programs and actions. Choosing a project focuses its space, or creates it with a terminal there. `@w`, `@b`, `@d`, `@i` and `@a` keep only windows whose agent is working, blocked, done, idle, or needs attention.

## Agents

Each window running Claude Code or pi shows a badge: **working**, **needs you**, **done** (finished while you looked elsewhere) or **idle**. The bar counts them; a window waiting for an answer gets an orange border.

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
relay windows                   # JSON, with agent states
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
roots = ["~/dev", "~/dev/peren"]

[programs]
claude = "claude"
pi = "pi"
lazygit = "lazygit"
```

`~/.config/relay/keybindings.toml` overrides or adds bindings with Illium's syntax. An empty command unbinds a key.

```toml
[keybindings]
"Mod+P" = "palette toggle"
"Leader g" = "popup lazygit"
"Leader c" = "spawn claude"
"Mod+Q" = ""
```

Both files reload when saved. Commands: `window focus|move left|right|up|down`, `window resize --width|--height ±N%`, `window toggle-fullscreen`, `window toggle-float`, `window set-tiling`, `window close`, `window move-workspace N [--follow]`, `workspace N`, `workspace next-active`, `workspace recent`, `space next|recent|picker`, `spawn <program>`, `popup <command>`, `palette toggle`, `keybindings toggle`, `client detach`, `config reload`, `server stop`.

## State

The server keeps its socket, log and `state.json` in `~/.local/state/relay/`. Processes do not survive a server restart: windows come back as shells in their last directory, and agents with a known session are resumed (`claude --resume`, `pi --session`). Delete `state.json` to start from scratch.

## Credits

- The terminal core, agent detection rules and integrations follow [herdr](https://github.com/herdrdev/herdr) (Apache-2.0). `src/detect/manifests/*.toml` are copied from it; `src/integration/relay-agent-state.ts` is adapted from its pi extension.
- The window look, animations and palette take after [tuios](https://github.com/Gaurav-Gosain/tuios).
- Concepts and keys come from Illium.
- Terminal emulation is [alacritty_terminal](https://github.com/alacritty/alacritty).
