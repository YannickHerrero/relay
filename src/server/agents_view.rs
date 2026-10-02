//! The agents dashboard: every agent and its state, most urgent first.

use crossterm::event::{KeyCode, KeyEvent};

use super::Server;
use super::chrome;
use super::overlay::{ListOverlay, Outcome, Row, Target};
use crate::config::tilde;
use crate::detect::process;
use crate::detect::tracker::Status;

fn urgency(status: Option<Status>) -> u8 {
    match status {
        Some(Status::Blocked) => 0,
        Some(Status::Working) => 1,
        Some(Status::Done) => 2,
        Some(Status::Idle) => 3,
        _ => 4,
    }
}

impl Server {
    pub(super) fn agent_rows(&self) -> Vec<Row> {
        let mut rows: Vec<(u8, Row)> = Vec::new();
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
                        urgency(status),
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
        rows.sort_by_key(|(u, _)| *u);
        rows.into_iter().map(|(_, row)| row).collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocked_agents_come_first() {
        let mut statuses = vec![
            Some(Status::Idle),
            Some(Status::Blocked),
            Some(Status::Working),
        ];
        statuses.sort_by_key(|s| urgency(*s));
        assert_eq!(statuses[0], Some(Status::Blocked));
        assert_eq!(statuses[2], Some(Status::Idle));
    }
}
