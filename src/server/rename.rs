//! Naming a window or a workspace: a one-line prompt over the screen.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;

use super::{Server, chrome};
use crate::model::{Location, WindowId};
use crate::ui::panel;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenameTarget {
    Window(WindowId),
    Workspace(Location),
}

#[derive(Debug, Clone)]
pub struct RenamePrompt {
    pub target: RenameTarget,
    pub text: String,
}

impl Server {
    pub(super) fn start_rename(&mut self, target: RenameTarget) {
        let text = match target {
            RenameTarget::Window(id) => {
                let Some(w) = self.windows.get(&id) else {
                    return;
                };
                w.name.clone().unwrap_or_else(|| chrome::title(w))
            }
            RenameTarget::Workspace(at) => self.model.spaces[at.space].workspaces[at.workspace]
                .name
                .clone()
                .unwrap_or_default(),
        };
        self.rename = Some(RenamePrompt { target, text });
        self.dirty = true;
    }

    pub(super) fn on_rename_key(&mut self, key: KeyEvent) {
        let Some(prompt) = &mut self.rename else {
            return;
        };
        match key.code {
            KeyCode::Esc => self.rename = None,
            KeyCode::Enter => {
                let text = prompt.text.trim().to_owned();
                // An empty name goes back to the default: the automatic
                // title, or the bare workspace number.
                let name = (!text.is_empty()).then_some(text);
                match prompt.target {
                    RenameTarget::Window(id) => {
                        if let Some(window) = self.windows.get_mut(&id) {
                            window.name = name;
                        }
                    }
                    RenameTarget::Workspace(at) => {
                        if let Some(ws) = self
                            .model
                            .spaces
                            .get_mut(at.space)
                            .and_then(|s| s.workspaces.get_mut(at.workspace))
                        {
                            ws.name = name;
                        }
                    }
                }
                self.rename = None;
            }
            KeyCode::Backspace => {
                prompt.text.pop();
            }
            KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                prompt.text.clear()
            }
            KeyCode::Char(c) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                prompt.text.push(c)
            }
            _ => {}
        }
        self.dirty = true;
    }

    pub(super) fn draw_rename(&self, area: Rect, buf: &mut Buffer) {
        let Some(prompt) = &self.rename else {
            return;
        };
        let width = area.width.saturating_sub(4).min(60);
        let rect = Rect::new(
            area.x + (area.width - width) / 2,
            area.y + area.height / 3,
            width,
            4,
        );
        let title = match prompt.target {
            RenameTarget::Window(_) => "Rename window".to_owned(),
            RenameTarget::Workspace(at) => format!("Rename workspace {}", at.workspace + 1),
        };
        let inner = panel::draw(rect, &title, "⏎ save · empty resets · esc cancel", buf);
        self.draw_input(inner, "❯", &prompt.text, buf);
    }
}
