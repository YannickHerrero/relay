use alacritty_terminal::grid::Scroll;
use alacritty_terminal::term::TermMode;
use crossterm::event::{KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::layout::{Position, Rect};

use super::bar::BarItem;
use super::{Server, inner};
use crate::encode;
use crate::model::WindowId;

const WHEEL_LINES: i32 = 3;

/// What lies under the pointer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hit {
    Bar(Option<BarItem>),
    /// Inside a window's terminal, at a cell relative to it.
    Content {
        window: WindowId,
        col: u16,
        row: u16,
    },
    Border {
        window: WindowId,
    },
    Nothing,
}

impl Server {
    /// Topmost window of the current workspace at a screen cell.
    pub(super) fn window_at(&self, x: u16, y: u16) -> Option<WindowId> {
        let ws = self.model.workspace();
        if let Some(id) = ws.fullscreen {
            return Some(id);
        }
        let point = Position::new(x, y);
        ws.floating
            .iter()
            .rev()
            .chain(ws.tiled.iter())
            .copied()
            .find(|id| self.windows.get(id).is_some_and(|w| w.rect.contains(point)))
    }

    pub(super) fn hit(&self, x: u16, y: u16) -> Hit {
        if y == 0 {
            return Hit::Bar(self.bar_item_at(x));
        }
        let Some(window) = self.window_at(x, y) else {
            return Hit::Nothing;
        };
        let area = inner(self.windows[&window].rect);
        if area.contains(Position::new(x, y)) {
            Hit::Content {
                window,
                col: x - area.x,
                row: y - area.y,
            }
        } else {
            Hit::Border { window }
        }
    }

    pub(super) fn on_mouse(&mut self, event: MouseEvent) {
        let hit = self.hit(event.column, event.row);
        match event.kind {
            MouseEventKind::ScrollUp | MouseEventKind::ScrollDown => self.on_wheel(event, hit),
            MouseEventKind::Down(button) => self.on_press(event, button, hit),
            MouseEventKind::Drag(_) | MouseEventKind::Moved | MouseEventKind::Up(_) => {
                if let Some(window) = self.mouse_owner {
                    self.forward_mouse(window, event);
                    if matches!(event.kind, MouseEventKind::Up(_)) {
                        self.mouse_owner = None;
                    }
                }
            }
            _ => {}
        }
        self.dirty = true;
    }

    fn on_wheel(&mut self, event: MouseEvent, hit: Hit) {
        let Hit::Content { window: id, .. } = hit else {
            return;
        };
        let Some(window) = self.windows.get_mut(&id) else {
            return;
        };
        let mode = *window.pane.term.mode();
        let up = event.kind == MouseEventKind::ScrollUp;
        if mode.intersects(TermMode::MOUSE_MODE) && !event.modifiers.contains(KeyModifiers::SHIFT) {
            self.forward_mouse(id, event);
        } else if mode.contains(TermMode::ALT_SCREEN) && mode.contains(TermMode::ALTERNATE_SCROLL) {
            let arrow: &[u8] = match (up, mode.contains(TermMode::APP_CURSOR)) {
                (true, true) => b"\x1bOA",
                (true, false) => b"\x1b[A",
                (false, true) => b"\x1bOB",
                (false, false) => b"\x1b[B",
            };
            window.pane.write(arrow.repeat(WHEEL_LINES as usize));
        } else {
            let delta = if up { WHEEL_LINES } else { -WHEEL_LINES };
            window.pane.term.scroll_display(Scroll::Delta(delta));
        }
    }

    fn on_press(&mut self, event: MouseEvent, button: MouseButton, hit: Hit) {
        match hit {
            Hit::Bar(Some(BarItem::Workspace(n))) if button == MouseButton::Left => {
                self.model.space_mut().switch(n);
                self.mark_focused_seen();
            }
            Hit::Content { window, .. } => {
                if self.model.focused() != Some(window) {
                    self.focus(window);
                }
                let mode = *self.windows[&window].pane.term.mode();
                if mode.intersects(TermMode::MOUSE_MODE)
                    && !event.modifiers.contains(KeyModifiers::SHIFT)
                {
                    self.mouse_owner = Some(window);
                    self.forward_mouse(window, event);
                }
            }
            Hit::Border { window } => self.focus(window),
            _ => {}
        }
    }

    /// Sends a mouse event to the program in `id`, relative to its terminal.
    fn forward_mouse(&mut self, id: WindowId, event: MouseEvent) {
        let Some(window) = self.windows.get(&id) else {
            return;
        };
        let area: Rect = inner(window.rect);
        let col = event
            .column
            .saturating_sub(area.x)
            .min(area.width.saturating_sub(1));
        let row = event
            .row
            .saturating_sub(area.y)
            .min(area.height.saturating_sub(1));
        let bytes = encode::mouse(
            event.kind,
            event.modifiers,
            col,
            row,
            *window.pane.term.mode(),
        );
        if !bytes.is_empty() {
            window.pane.write(bytes);
        }
    }
}
