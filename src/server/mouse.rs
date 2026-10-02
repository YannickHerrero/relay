use std::time::{Duration, Instant};

use alacritty_terminal::grid::{Dimensions, Scroll};
use alacritty_terminal::index::{Column, Line, Point, Side};
use alacritty_terminal::selection::{Selection, SelectionType};
use alacritty_terminal::term::TermMode;
use crossterm::event::{KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::layout::{Position, Rect};

use super::bar::BarItem;
use super::{Server, inner};
use crate::encode;
use crate::model::WindowId;

const WHEEL_LINES: i32 = 3;
const MULTI_CLICK: Duration = Duration::from_millis(400);

/// A mouse gesture in progress.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Drag {
    /// The program in the window asked for the mouse and gets the gesture.
    Forward(WindowId),
    Select(WindowId),
}

#[derive(Debug, Default)]
pub struct MouseState {
    pub drag: Option<Drag>,
    last_click: Option<(Instant, u16, u16, u8)>,
}

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
            MouseEventKind::Drag(_) | MouseEventKind::Moved => match self.mouse.drag {
                Some(Drag::Forward(window)) => self.forward_mouse(window, event),
                Some(Drag::Select(window)) => self.extend_selection(window, event),
                None => {}
            },
            MouseEventKind::Up(_) => match self.mouse.drag.take() {
                Some(Drag::Forward(window)) => self.forward_mouse(window, event),
                Some(Drag::Select(window)) => self.finish_selection(window),
                None => {}
            },
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
            Hit::Content { window, col, row } => {
                if self.model.focused() != Some(window) {
                    self.focus(window);
                }
                let mode = *self.windows[&window].pane.term.mode();
                if mode.intersects(TermMode::MOUSE_MODE)
                    && !event.modifiers.contains(KeyModifiers::SHIFT)
                {
                    self.mouse.drag = Some(Drag::Forward(window));
                    self.forward_mouse(window, event);
                } else if button == MouseButton::Left {
                    self.start_selection(window, col, row);
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

    fn click_count(&mut self, x: u16, y: u16) -> u8 {
        let now = Instant::now();
        let count = match self.mouse.last_click {
            Some((t, lx, ly, n)) if now - t < MULTI_CLICK && (lx, ly) == (x, y) => n % 3 + 1,
            _ => 1,
        };
        self.mouse.last_click = Some((now, x, y, count));
        count
    }

    fn start_selection(&mut self, id: WindowId, col: u16, row: u16) {
        let count = self.click_count(col, row);
        let Some(window) = self.windows.get_mut(&id) else {
            return;
        };
        let term = &mut window.pane.term;
        let point = viewport_point(term.grid().display_offset(), col, row);
        let ty = match count {
            2 => SelectionType::Semantic,
            3 => SelectionType::Lines,
            _ => SelectionType::Simple,
        };
        term.selection = Some(Selection::new(ty, point, Side::Left));
        if ty != SelectionType::Simple
            && let Some(selection) = &mut term.selection
        {
            selection.update(point, Side::Right);
        }
        self.mouse.drag = Some(Drag::Select(id));
    }

    fn extend_selection(&mut self, id: WindowId, event: MouseEvent) {
        let Some(window) = self.windows.get_mut(&id) else {
            return;
        };
        let area = inner(window.rect);
        let col = event
            .column
            .saturating_sub(area.x)
            .min(area.width.saturating_sub(1));
        let row = event
            .row
            .saturating_sub(area.y)
            .min(area.height.saturating_sub(1));
        let term = &mut window.pane.term;
        let point = viewport_point(term.grid().display_offset(), col, row);
        if let Some(selection) = &mut term.selection {
            selection.update(point, Side::Right);
        }
    }

    fn finish_selection(&mut self, id: WindowId) {
        let Some(window) = self.windows.get_mut(&id) else {
            return;
        };
        let term = &mut window.pane.term;
        match term.selection_to_string().filter(|t| !t.is_empty()) {
            Some(text) => self.copy_to_clipboard(&text),
            None => term.selection = None,
        }
    }

    /// Puts text on the client terminal's clipboard (OSC 52).
    pub(super) fn copy_to_clipboard(&mut self, text: &str) {
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(text);
        self.send_raw(format!("\x1b]52;c;{encoded}\x07").into_bytes());
    }
}

fn viewport_point(display_offset: usize, col: u16, row: u16) -> Point {
    Point::new(
        Line(row as i32 - display_offset as i32),
        Column(col as usize),
    )
}
