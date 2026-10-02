use std::time::{Duration, Instant};

use alacritty_terminal::grid::Scroll;
use alacritty_terminal::index::{Column, Line, Point, Side};
use alacritty_terminal::selection::{Selection, SelectionType};
use alacritty_terminal::term::TermMode;
use crossterm::event::{KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::layout::{Position, Rect};

use super::bar::BarItem;
use super::chrome::{self, Button};
use super::{Server, inner};
use crate::actions::Action;
use crate::encode;
use crate::layout::{self, Axis};
use crate::model::WindowId;

const WHEEL_LINES: i32 = 3;
const MULTI_CLICK: Duration = Duration::from_millis(400);

/// A mouse gesture in progress.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Drag {
    /// The program in the window asked for the mouse and gets the gesture.
    Forward(WindowId),
    Select(WindowId),
    /// Dragging a title bar: moves a float, or swaps a tiled window with the
    /// one it is dropped on.
    Title {
        window: WindowId,
        grab: (u16, u16),
        origin: Rect,
    },
    /// Dragging the boundary of a fibonacci split.
    Split(usize),
    /// Dragging a floating window's edge.
    Resize(WindowId),
}

#[derive(Debug, Default)]
pub struct MouseState {
    pub drag: Option<Drag>,
    pub pointer: (u16, u16),
    /// Window whose title-bar buttons are under the pointer.
    pub hover_buttons: Option<WindowId>,
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
        self.mouse.pointer = (event.column, event.row);
        if self.menu.is_some() {
            self.on_menu_mouse(event);
            return;
        }
        if self.overlay.is_some() {
            self.on_overlay_mouse(event);
            return;
        }
        let hit = self.hit(event.column, event.row);
        match event.kind {
            MouseEventKind::ScrollUp | MouseEventKind::ScrollDown => self.on_wheel(event, hit),
            MouseEventKind::Down(button) => self.on_press(event, button, hit),
            MouseEventKind::Drag(_) | MouseEventKind::Moved => match self.mouse.drag {
                Some(Drag::Forward(window)) => self.forward_mouse(window, event),
                Some(Drag::Select(window)) => self.extend_selection(window, event),
                Some(Drag::Title {
                    window,
                    grab,
                    origin,
                }) => {
                    if self.model.is_floating(window) {
                        self.move_float(window, grab, origin, event.column, event.row);
                    }
                }
                Some(Drag::Split(level)) => self.drag_split(level, event.column, event.row),
                Some(Drag::Resize(window)) => self.resize_float(window, event.column, event.row),
                None => {
                    self.mouse.hover_buttons =
                        self.window_at(event.column, event.row).filter(|id| {
                            chrome::button_at(self.windows[id].rect, event.column, event.row)
                                .is_some()
                        });
                }
            },
            MouseEventKind::Up(_) => match self.mouse.drag.take() {
                Some(Drag::Forward(window)) => self.forward_mouse(window, event),
                Some(Drag::Select(window)) => self.finish_selection(window),
                Some(Drag::Title { window, .. }) => {
                    if let Some(target) = self.swap_target(window, event.column, event.row) {
                        self.model.swap(window, target);
                        self.relayout();
                    }
                }
                Some(Drag::Split(_) | Drag::Resize(_)) | None => {}
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
            Hit::Bar(Some(item)) if button == MouseButton::Right => {
                self.bar_menu(item, event.column)
            }
            Hit::Content { window, .. } | Hit::Border { window }
                if button == MouseButton::Right
                    && !(matches!(hit, Hit::Content { .. })
                        && self.app_wants_mouse(window, event.modifiers)) =>
            {
                self.window_menu(window, event.column, event.row);
            }
            Hit::Bar(Some(BarItem::Space)) if button == MouseButton::Left => {
                self.open_list(super::overlay::ListKind::Spaces);
            }
            Hit::Bar(Some(BarItem::Workspace(n))) if button == MouseButton::Left => {
                self.model.space_mut().switch(n);
                self.mark_visible_seen();
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
            Hit::Border { window } if button == MouseButton::Left => {
                self.focus(window);
                self.press_border(window, event.column, event.row);
            }
            Hit::Border { window } => self.focus(window),
            _ => {}
        }
    }

    /// The program in the window asked for mouse reports and Shift, which
    /// overrides that, is not held.
    fn app_wants_mouse(&self, id: WindowId, mods: KeyModifiers) -> bool {
        self.windows
            .get(&id)
            .is_some_and(|w| w.pane.term.mode().intersects(TermMode::MOUSE_MODE))
            && !mods.contains(KeyModifiers::SHIFT)
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

    fn press_border(&mut self, id: WindowId, x: u16, y: u16) {
        let rect = self.windows[&id].rect;
        if let Some(button) = chrome::button_at(rect, x, y) {
            match button {
                Button::Float => self.execute(Action::WindowToggleFloat),
                Button::Zoom => self.execute(Action::WindowFullscreen),
                Button::Close => self.close_window(id),
            }
            return;
        }
        let fullscreen = self.model.workspace().fullscreen.is_some();
        self.mouse.drag = if y == rect.y && !fullscreen {
            Some(Drag::Title {
                window: id,
                grab: (x, y),
                origin: rect,
            })
        } else if fullscreen {
            None
        } else if self.model.is_floating(id) {
            Some(Drag::Resize(id))
        } else {
            self.split_at(x, y).map(Drag::Split)
        };
    }

    /// The split whose boundary runs through a cell: the border columns (or
    /// rows) on both sides of it.
    fn split_at(&self, x: u16, y: u16) -> Option<usize> {
        let ws = self.model.workspace();
        let (_, splits) =
            layout::fibonacci_with_splits(self.work_area(), ws.tiled.len(), &ws.ratios);
        splits.iter().find_map(|split| {
            let hit = match split.axis {
                Axis::Vertical => {
                    let edge = split.first.right();
                    (x == edge - 1 || x == edge) && y >= split.area.y && y < split.area.bottom()
                }
                Axis::Horizontal => {
                    let edge = split.first.bottom();
                    (y == edge - 1 || y == edge) && x >= split.area.x && x < split.area.right()
                }
            };
            hit.then_some(split.level)
        })
    }

    fn drag_split(&mut self, level: usize, x: u16, y: u16) {
        let area = self.work_area();
        let ws = self.model.workspace_mut();
        let (_, splits) = layout::fibonacci_with_splits(area, ws.tiled.len(), &ws.ratios);
        let Some(split) = splits.iter().find(|s| s.level == level) else {
            return;
        };
        let position = match split.axis {
            Axis::Vertical => x,
            Axis::Horizontal => y,
        };
        if ws.ratios.len() <= level {
            ws.ratios.resize(level + 1, layout::DEFAULT_RATIO);
        }
        ws.ratios[level] = layout::ratio_at(split, position);
        self.relayout();
    }

    fn move_float(&mut self, id: WindowId, grab: (u16, u16), origin: Rect, x: u16, y: u16) {
        let area = self.work_area();
        let Some(window) = self.windows.get_mut(&id) else {
            return;
        };
        let dx = x as i32 - grab.0 as i32;
        let dy = y as i32 - grab.1 as i32;
        let max_x = area.right().saturating_sub(origin.width) as i32;
        let max_y = area.bottom().saturating_sub(origin.height) as i32;
        let nx = (origin.x as i32 + dx).clamp(area.x as i32, max_x.max(area.x as i32));
        let ny = (origin.y as i32 + dy).clamp(area.y as i32, max_y.max(area.y as i32));
        window.float_rect = Some(Rect::new(nx as u16, ny as u16, origin.width, origin.height));
        self.relayout();
    }

    fn resize_float(&mut self, id: WindowId, x: u16, y: u16) {
        let area = self.work_area();
        let Some(window) = self.windows.get_mut(&id) else {
            return;
        };
        let Some(rect) = window.float_rect else {
            return;
        };
        let width = (x.saturating_sub(rect.x) + 1).clamp(layout::MIN_WIDTH, area.right() - rect.x);
        let height =
            (y.saturating_sub(rect.y) + 1).clamp(layout::MIN_HEIGHT, area.bottom() - rect.y);
        window.float_rect = Some(Rect::new(rect.x, rect.y, width, height));
        self.relayout();
    }

    /// The tiled window a dragged tiled window would swap with.
    pub(super) fn swap_target(&self, dragged: WindowId, x: u16, y: u16) -> Option<WindowId> {
        if self.model.is_floating(dragged) {
            return None;
        }
        let ws = self.model.workspace();
        let point = Position::new(x, y);
        ws.tiled.iter().copied().find(|id| {
            *id != dragged && self.windows.get(id).is_some_and(|w| w.rect.contains(point))
        })
    }

    /// Window highlighted as the drop target of a title drag.
    pub(super) fn drop_target(&self) -> Option<WindowId> {
        match self.mouse.drag {
            Some(Drag::Title { window, .. }) => {
                let (x, y) = self.mouse.pointer;
                self.swap_target(window, x, y)
            }
            _ => None,
        }
    }
}

fn viewport_point(display_offset: usize, col: u16, row: u16) -> Point {
    Point::new(
        Line(row as i32 - display_offset as i32),
        Column(col as usize),
    )
}
