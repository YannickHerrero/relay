//! The agents dashboard: every agent and its state, in the order they
//! started.

use crossterm::event::{KeyCode, KeyEvent};

use super::Server;
use super::chrome;
use super::overlay::{ListOverlay, Outcome, Row, Target};
use crate::config::tilde;
use crate::detect::process;

impl Server {
    pub(super) fn agent_rows(&self) -> Vec<Row> {
        let mut rows: Vec<(Option<std::time::Instant>, u64, Row)> = Vec::new();
        for (s, space) in self.model.spaces.iter().enumerate() {
            if self.agents_current_space && s != self.model.active {
                continue;
            }
            for (n, ws) in space.workspaces.iter().enumerate() {
                for id in ws.windows() {
                    let Some(window) = self.windows.get(&id) else {
                        continue;
                    };
                    let Some(agent) = window.tracker.agent() else {
                        continue;
                    };
                    let status = window.tracker.status();
                    let cwd = window
                        .pane
                        .pid()
                        .and_then(process::cwd)
                        .map(|p| tilde(&p))
                        .unwrap_or_default();
                    rows.push((
                        window.tracker.started(),
                        id,
                        Row {
                            label: format!("{} · {}", agent.name(), chrome::title(window)),
                            detail: format!("{} · {} · {cwd}", space.name, n + 1),
                            status,
                            tag: "",
                            target: Some(Target::Window(id)),
                        },
                    ));
                }
            }
        }
        // First agent started on top, whatever its state.
        rows.sort_by_key(|(started, id, _)| (*started, *id));
        rows.into_iter().map(|(_, _, row)| row).collect()
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
