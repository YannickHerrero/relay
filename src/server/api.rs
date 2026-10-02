//! Requests from the CLI and agent hooks.

use anyhow::{Context, anyhow, bail};
use serde_json::{Value, json};

use super::{Server, chrome};
use crate::config::{self, tilde};
use crate::detect::Agent;
use crate::detect::manifest::AgentState;
use crate::detect::process;
use crate::encode;
use crate::keys::Chord;
use crate::model::{Location, WindowId};
use crate::protocol::Request;

pub fn parse_window(id: &str) -> anyhow::Result<WindowId> {
    id.trim_start_matches('w')
        .parse()
        .map_err(|_| anyhow!("not a window id: {id}"))
}

fn parse_agent(name: &str) -> anyhow::Result<Agent> {
    match name {
        "claude" => Ok(Agent::Claude),
        "pi" => Ok(Agent::Pi),
        other => bail!("unknown agent: {other}"),
    }
}

impl Server {
    pub(super) fn api(&mut self, request: Request) -> anyhow::Result<Value> {
        match request {
            Request::Status => Ok(json!({
                "version": env!("CARGO_PKG_VERSION"),
                "attached": self.client.is_some(),
                "spaces": self.model.spaces.len(),
                "windows": self.windows.len(),
            })),
            Request::ListSpaces => Ok(Value::Array(self.space_list())),
            Request::ListWindows => Ok(Value::Array(self.window_list())),
            Request::OpenSpace { path, name } => {
                let path = config::expand_home(&path);
                if !path.is_dir() {
                    bail!("not a directory: {}", path.display());
                }
                let index = self.open_space(&path, name.as_deref());
                Ok(json!({ "space": self.model.spaces[index].name }))
            }
            Request::Run {
                command,
                space,
                workspace,
                float,
            } => {
                let space = match space {
                    Some(name) => self
                        .model
                        .find_space(&name)
                        .with_context(|| format!("no space named {name}"))?,
                    None => self.model.active,
                };
                let workspace = match workspace {
                    Some(n @ 1..=9) => n - 1,
                    Some(n) => bail!("workspace must be 1 to 9, not {n}"),
                    None => self.model.spaces[space].active,
                };
                let cwd = if space == self.model.active {
                    self.new_window_cwd()
                } else {
                    self.model.spaces[space].cwd.clone()
                };
                let id = self
                    .spawn_shell_at(Location { space, workspace }, cwd, Some(&command), float)
                    .context("cannot start the window")?;
                Ok(json!({ "window": format!("w{id}") }))
            }
            Request::SendText { window, text } => {
                let id = parse_window(&window)?;
                let window = self
                    .windows
                    .get(&id)
                    .with_context(|| format!("no window {window}"))?;
                window.pane.write(text);
                Ok(Value::Null)
            }
            Request::SendKeys { window, keys } => {
                let id = parse_window(&window)?;
                let chords = keys
                    .iter()
                    .map(|k| {
                        Chord::parse(k, self.config.modifier)
                            .with_context(|| format!("not a key: {k}"))
                    })
                    .collect::<anyhow::Result<Vec<_>>>()?;
                let window = self
                    .windows
                    .get(&id)
                    .with_context(|| format!("no window {window}"))?;
                let mode = *window.pane.term.mode();
                let bytes: Vec<u8> = chords
                    .iter()
                    .flat_map(|c| encode::key(&c.to_event(), mode))
                    .collect();
                window.pane.write(bytes);
                Ok(Value::Null)
            }
            Request::ReportSession {
                window,
                agent,
                session,
            } => {
                let id = parse_window(&window)?;
                let agent = parse_agent(&agent)?;
                let window = self
                    .windows
                    .get_mut(&id)
                    .with_context(|| format!("no window {window}"))?;
                window.tracker.on_hook_session(agent, session);
                Ok(Value::Null)
            }
            Request::ReportState {
                window,
                agent,
                state,
                seq,
            } => {
                let id = parse_window(&window)?;
                let agent = parse_agent(&agent)?;
                let state = match state.as_str() {
                    "working" => AgentState::Working,
                    "blocked" => AgentState::Blocked,
                    "idle" => AgentState::Idle,
                    other => bail!("unknown state: {other}"),
                };
                let visible = (self.client.is_some() && self.model.workspace().contains(id))
                    || self.viewed().contains(&id);
                let window = self
                    .windows
                    .get_mut(&id)
                    .with_context(|| format!("no window {window}"))?;
                window.tracker.on_hook_state(agent, state, seq, visible);
                Ok(Value::Null)
            }
            Request::View { .. } => bail!("only remote clients view windows"),
            Request::Transcript {
                window,
                before,
                limit,
            } => self.transcript_page(&window, before, limit),
            Request::ReadScreen { window } => {
                let id = parse_window(&window)?;
                let window = self
                    .windows
                    .get(&id)
                    .with_context(|| format!("no window {window}"))?;
                let text = window.pane.snapshot().text;
                Ok(json!({ "lines": text.lines().collect::<Vec<_>>() }))
            }
            Request::RemotePairing { revoke } => self.remote_pairing(revoke),
            Request::ReloadConfig => {
                self.reload_config();
                Ok(Value::Null)
            }
            Request::Stop => {
                self.quit = true;
                Ok(Value::Null)
            }
        }
    }

    pub(super) fn space_list(&self) -> Vec<Value> {
        self.model
            .spaces
            .iter()
            .enumerate()
            .map(|(i, s)| {
                json!({
                    "name": s.name,
                    "cwd": s.cwd,
                    "active": i == self.model.active,
                    "workspace": s.active + 1,
                    "windows": s.windows().count(),
                })
            })
            .collect()
    }

    pub(super) fn window_list(&self) -> Vec<Value> {
        let mut list = Vec::new();
        for (s, space) in self.model.spaces.iter().enumerate() {
            for (n, ws) in space.workspaces.iter().enumerate() {
                for id in ws.windows() {
                    let Some(window) = self.windows.get(&id) else {
                        continue;
                    };
                    let mut entry = json!({
                        "id": format!("w{id}"),
                        "space": space.name,
                        "workspace": n + 1,
                        "title": chrome::title(window),
                        "agent": window.tracker.agent().map(Agent::name),
                        "status": window.tracker.status(),
                        "cwd": window.pane.pid().and_then(process::cwd).map(|p| tilde(&p)),
                        "focused": s == self.model.active && n == space.active && ws.focused == Some(id),
                        "floating": ws.floating.contains(&id),
                    });
                    if let (Value::Object(entry), Value::Object(extra)) =
                        (&mut entry, self.conversation_fields(id))
                    {
                        entry.extend(extra);
                    }
                    list.push(entry);
                }
            }
        }
        list
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_ids_accept_both_forms() {
        assert_eq!(parse_window("w12").unwrap(), 12);
        assert_eq!(parse_window("7").unwrap(), 7);
        assert!(parse_window("pane").is_err());
    }
}
