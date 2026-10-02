//! Saving the layout and bringing it back after a restart.

use std::time::Duration;

use ratatui::layout::Rect;

use super::Server;
use crate::config;
use crate::detect::{Agent, process};
use crate::model::{Location, Model, Space, WORKSPACES};
use crate::persist::{self, SpaceState, State, WindowState, WorkspaceState};

pub const SAVE_INTERVAL: Duration = Duration::from_secs(2);

impl Server {
    pub(super) fn snapshot(&self) -> State {
        let spaces = self
            .model
            .spaces
            .iter()
            .map(|space| SpaceState {
                name: space.name.clone(),
                cwd: space.cwd.clone(),
                active: space.active,
                recent: space.recent,
                workspaces: space
                    .workspaces
                    .iter()
                    .map(|ws| {
                        let ids: Vec<_> = ws
                            .windows()
                            .filter(|id| self.windows.get(id).is_some_and(|w| !w.popup))
                            .collect();
                        let windows = ids
                            .iter()
                            .map(|id| {
                                let window = &self.windows[id];
                                WindowState {
                                    cwd: window
                                        .pane
                                        .pid()
                                        .and_then(process::cwd)
                                        .unwrap_or_else(|| space.cwd.clone()),
                                    floating: ws
                                        .floating
                                        .contains(id)
                                        .then(|| {
                                            window.float_rect.map(|r| [r.x, r.y, r.width, r.height])
                                        })
                                        .flatten(),
                                    agent: window.tracker.agent(),
                                    session: window.tracker.session().map(str::to_owned),
                                }
                            })
                            .collect();
                        let index =
                            |id: Option<u64>| id.and_then(|id| ids.iter().position(|i| *i == id));
                        WorkspaceState {
                            ratios: ws.ratios.clone(),
                            windows,
                            focused: index(ws.focused),
                            fullscreen: index(ws.fullscreen),
                        }
                    })
                    .collect(),
            })
            .collect();
        State {
            version: persist::VERSION,
            active: self.model.active,
            recent: self.model.recent,
            spaces,
        }
    }

    /// Saves the state when it changed since the last save.
    pub(super) fn save_state(&mut self) {
        let state = self.snapshot();
        if self.saved.as_ref() == Some(&state) {
            return;
        }
        match persist::save(&persist::path(), &state) {
            Ok(()) => self.saved = Some(state),
            Err(e) => eprintln!("relay: cannot save state: {e}"),
        }
    }

    pub(super) fn restore(&mut self, state: State) {
        let mut model = Model::new(Space::new("main", config::home()));
        model.spaces = state
            .spaces
            .iter()
            .map(|s| {
                let mut space = Space::new(&s.name, s.cwd.clone());
                space.active = s.active.min(WORKSPACES - 1);
                space.recent = s.recent.min(WORKSPACES - 1);
                space
            })
            .collect();
        model.active = state.active.min(model.spaces.len() - 1);
        model.recent = state.recent.min(model.spaces.len() - 1);
        self.model = model;

        for (s, space) in state.spaces.iter().enumerate() {
            for (n, ws) in space.workspaces.iter().enumerate().take(WORKSPACES) {
                let mut ids = Vec::new();
                for window in &ws.windows {
                    let cwd = [&window.cwd, &space.cwd]
                        .into_iter()
                        .find(|p| p.is_dir())
                        .cloned()
                        .unwrap_or_else(config::home);
                    let at = Location {
                        space: s,
                        workspace: n,
                    };
                    let resume = window
                        .agent
                        .zip(window.session.as_deref())
                        .and_then(|(agent, session)| resume_command(agent, session));
                    let id =
                        self.spawn_shell_at(at, cwd, resume.as_deref(), window.floating.is_some());
                    if let Some(w_) = id.and_then(|id| self.windows.get_mut(&id)) {
                        if let Some([x, y, w, h]) = window.floating {
                            w_.float_rect = Some(Rect::new(x, y, w, h));
                        }
                        if let (Some(_), Some(session)) = (&resume, &window.session) {
                            w_.tracker.restore(session.clone());
                        }
                    }
                    ids.push(id);
                }
                let restored = &mut self.model.spaces[s].workspaces[n];
                restored.ratios = ws.ratios.clone();
                let pick = |i: Option<usize>| i.and_then(|i| ids.get(i).copied().flatten());
                if let Some(id) = pick(ws.focused) {
                    restored.focused = Some(id);
                }
                restored.fullscreen = pick(ws.fullscreen);
            }
        }
        self.relayout();
        self.saved = Some(self.snapshot());
    }
}

/// The command that brings an agent conversation back, typed into the
/// restored window's shell so the shell remains when the agent exits.
pub fn resume_command(agent: Agent, session: &str) -> Option<String> {
    let valid =
        !session.is_empty() && session.len() <= 4096 && !session.chars().any(char::is_control);
    if !valid {
        return None;
    }
    let args = match agent {
        Agent::Claude => ["claude", "--resume", session],
        Agent::Pi => ["pi", "--session", session],
    };
    Some(
        args.iter()
            .map(|a| shell_quote(a))
            .collect::<Vec<_>>()
            .join(" "),
    )
}

fn shell_quote(arg: &str) -> String {
    let bare = arg
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "_-./:@%+=".contains(c));
    if bare && !arg.is_empty() {
        arg.to_owned()
    } else {
        format!("'{}'", arg.replace('\'', "'\\''"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resume_commands_are_quoted() {
        assert_eq!(
            resume_command(Agent::Claude, "4f2c-11").as_deref(),
            Some("claude --resume 4f2c-11")
        );
        assert_eq!(
            resume_command(Agent::Pi, "/home/u/my sessions/it's.jsonl").as_deref(),
            Some("pi --session '/home/u/my sessions/it'\\''s.jsonl'")
        );
        assert_eq!(resume_command(Agent::Claude, "a\nb"), None);
    }
}
