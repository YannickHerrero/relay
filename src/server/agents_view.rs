//! The agents dashboard: every agent and its state, in the order they
//! started.

use crossterm::event::{KeyCode, KeyEvent};

use super::Server;
use super::chrome;
use super::overlay::{ListOverlay, Outcome, Row, Target};
use crate::config::tilde;
use crate::detect::process;
use crate::model::{Location, WindowId};

impl Server {
    /// Windows running an agent, first started first, with where they live.
    pub(super) fn agent_windows(&self, current_space_only: bool) -> Vec<(WindowId, Location)> {
        let mut found = Vec::new();
        for (s, space) in self.model.spaces.iter().enumerate() {
            if current_space_only && s != self.model.active {
                continue;
            }
            for (n, ws) in space.workspaces.iter().enumerate() {
                for id in ws.windows() {
                    if let Some(window) = self.windows.get(&id)
                        && window.tracker.agent().is_some()
                    {
                        let at = Location {
                            space: s,
                            workspace: n,
                        };
                        found.push((window.tracker.started(), id, at));
                    }
                }
            }
        }
        // First agent started on top, whatever its state.
        found.sort_by_key(|(started, id, _)| (*started, *id));
        found.into_iter().map(|(_, id, at)| (id, at)).collect()
    }

    pub(super) fn agent_rows(&self) -> Vec<Row> {
        self.agent_windows(self.agents_current_space)
            .into_iter()
            .filter_map(|(id, at)| {
                let window = self.windows.get(&id)?;
                let agent = window.tracker.agent()?;
                let space = &self.model.spaces[at.space];
                let cwd = window
                    .pane
                    .pid()
                    .and_then(process::cwd)
                    .map(|p| tilde(&p))
                    .unwrap_or_default();
                Some(Row {
                    label: format!("{} · {}", agent.name(), chrome::title(window)),
                    detail: format!("{} · {} · {cwd}", space.name, at.workspace + 1),
                    status: window.tracker.status(),
                    tag: "",
                    target: Some(Target::Window(id)),
                })
            })
            .collect()
    }

    pub(super) fn agents_key(&mut self, overlay: &mut ListOverlay, key: KeyEvent) -> Outcome {
        match key.code {
            KeyCode::Esc => return Outcome::Close,
            KeyCode::Enter => {
                let rows = self.agent_rows();
                if let Some(target) = rows.get(overlay.selected).and_then(|r| r.target.clone()) {
                    return Outcome::Run(target);
                }
            }
            KeyCode::Up | KeyCode::Char('k') => {
                overlay.selected = overlay.selected.saturating_sub(1)
            }
            KeyCode::Down | KeyCode::Char('j') => overlay.selected += 1,
            KeyCode::Tab => {
                self.agents_current_space = !self.agents_current_space;
                overlay.selected = 0;
            }
            _ => {}
        }
        Outcome::Keep
    }
}
