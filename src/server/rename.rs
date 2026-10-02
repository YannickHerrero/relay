//! Naming a window: a one-line prompt over the screen.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;

use super::{Server, chrome};
use crate::model::WindowId;
use crate::ui::panel;

#[derive(Debug, Clone)]
pub struct RenamePrompt {
    pub window: WindowId,
    pub text: String,
}

impl Server {
    pub(super) fn start_rename(&mut self, window: WindowId) {
        let Some(w) = self.windows.get(&window) else {
            return;
        };
        self.rename = Some(RenamePrompt {
            window,
            text: w.name.clone().unwrap_or_else(|| chrome::title(w)),
        });
        self.dirty = true;
    }

    pub(super) fn on_rename_key(&mut self, key: KeyEvent) {
        let Some(prompt) = &mut self.rename else {
            return;
        };
        match key.code {
            KeyCode::Esc => self.rename = None,
            KeyCode::Enter => {
                let name = prompt.text.trim().to_owned();
                if let Some(window) = self.windows.get_mut(&prompt.window) {
                    // An empty name goes back to the automatic title.
                    window.name = (!name.is_empty()).then_some(name);
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
        let inner = panel::draw(
            rect,
            "Rename window",
            "⏎ save · empty resets · esc cancel",
            buf,
        );
        self.draw_input(inner, "❯", &prompt.text, buf);
    }
}
