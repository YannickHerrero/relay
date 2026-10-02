//! The agents sidebar on the right, after herdr's: one two-line row per
//! agent with its state, space, workspace and name.

use std::time::Instant;

use crossterm::event::{MouseButton, MouseEvent, MouseEventKind};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use unicode_width::UnicodeWidthStr;

use super::Server;
use super::motion::{self, SLIDE};
use crate::detect::tracker::Status;
use crate::model::WindowId;
use crate::ui::theme;

const WIDTH: u16 = 28;
/// Rows above the list: header and a blank line.
const LIST_TOP: u16 = 2;

fn glyph(status: Option<Status>) -> (&'static str, Color) {
    match status {
        Some(Status::Working) => ("●", theme::YELLOW),
        Some(Status::Blocked) => ("●", theme::RED),
        Some(Status::Done) => ("●", theme::TEAL),
        Some(Status::Idle) => ("○", theme::GREEN),
        _ => ("·", theme::OVERLAY0),
    }
}

impl Server {
    /// Columns the sidebar takes from the windows, once fully open.
    pub(super) fn sidebar_width(&self) -> u16 {
        if self.sidebar.open {
            WIDTH.min(self.size.0 / 2)
        } else {
            0
        }
    }

    /// Columns drawn now, sliding while it opens or closes.
    pub(super) fn sidebar_shown(&self, now: Instant) -> u16 {
        let full = WIDTH.min(self.size.0 / 2) as f32;
        let t = self
            .sidebar
            .toggled
            .map(|start| motion::ease_out(motion::progress(start, SLIDE, now)))
            .unwrap_or(1.0)
            .min(1.0);
        let shown = if self.sidebar.open {
            full * t
        } else {
            full * (1.0 - t)
        };
        shown.round() as u16
    }

    pub(super) fn sidebar_sliding(&self, now: Instant) -> bool {
        self.sidebar
            .toggled
            .is_some_and(|start| now < start + SLIDE)
    }

    pub(super) fn toggle_sidebar(&mut self) {
        self.sidebar.open = !self.sidebar.open;
        self.sidebar.toggled = self.slides().then(Instant::now);
        self.relayout();
    }

    /// Area of the open sidebar on screen, for the mouse.
    /// Area of the open sidebar on screen, for the mouse. It runs the full
    /// height, next to the bar, so its separator reaches the top.
    fn sidebar_area(&self) -> Rect {
        let width = self.sidebar_width();
        let (cols, rows) = self.size;
        Rect::new(cols - width, 0, width, rows)
    }

    pub(super) fn sidebar_contains(&self, x: u16, y: u16) -> bool {
        self.sidebar_width() > 0 && self.sidebar_area().contains((x, y).into())
    }

    fn visible_agents(&self, height: u16) -> usize {
        (height.saturating_sub(LIST_TOP + 1) / 2) as usize
    }

    pub(super) fn on_sidebar_mouse(&mut self, event: MouseEvent) {
        let area = self.sidebar_area();
        let agents = self.agent_windows(false);
        let visible = self.visible_agents(area.height);
        let max_scroll = agents.len().saturating_sub(visible);
        match event.kind {
            MouseEventKind::ScrollUp => self.sidebar.scroll = self.sidebar.scroll.saturating_sub(1),
            MouseEventKind::ScrollDown => {
                self.sidebar.scroll = (self.sidebar.scroll + 1).min(max_scroll)
            }
            MouseEventKind::Down(MouseButton::Left) => {
                let (x, y) = (event.column - area.x, event.row - area.y);
                if y == area.height - 1 && x >= area.width.saturating_sub(3) {
                    self.toggle_sidebar();
                } else if y >= LIST_TOP {
                    let index = self.sidebar.scroll + ((y - LIST_TOP) / 2) as usize;
                    if let Some((id, _)) = agents.get(index) {
                        self.focus(*id);
                    }
                }
            }
            _ => {}
        }
        self.dirty = true;
    }

    pub(super) fn draw_sidebar(&self, screen: Rect, buf: &mut Buffer, now: Instant) {
        let shown = self.sidebar_shown(now);
        if shown == 0 {
            return;
        }
        let width = WIDTH.min(screen.width / 2);
        let height = screen.height;
        // Drawn at full width off screen, then the visible part is copied,
        // so the panel slides in instead of squeezing.
        let mut panel = Buffer::empty(Rect::new(0, 0, width, height));
        self.draw_sidebar_panel(&mut panel);
        let x0 = screen.right() - shown;
        for y in 0..height {
            for x in 0..shown.min(width) {
                buf[(x0 + x, screen.y + y)] = panel[(x, y)].clone();
            }
        }
    }

    fn draw_sidebar_panel(&self, buf: &mut Buffer) {
        let area = buf.area;
        let dim = Style::new().fg(theme::OVERLAY0);
        for y in 0..area.height {
            buf[(0, y)].set_symbol("│").set_fg(theme::SURFACE1);
        }
        let agents = self.agent_windows(false);
        let header = Style::new()
            .fg(theme::OVERLAY0)
            .add_modifier(Modifier::BOLD);
        buf.set_string(2, 0, "agents", header);
        let count = agents.len().to_string();
        buf.set_string(
            area.width.saturating_sub(count.width() as u16 + 1),
            0,
            &count,
            header,
        );

        let focused = self.model.focused();
        let visible = self.visible_agents(area.height);
        let scroll = self
            .sidebar
            .scroll
            .min(agents.len().saturating_sub(visible));
        for (i, (id, at)) in agents.iter().skip(scroll).take(visible).enumerate() {
            let y = LIST_TOP + 2 * i as u16;
            self.draw_agent_row(buf, *id, at.space, at.workspace, y, focused == Some(*id));
        }
        if agents.is_empty() {
            buf.set_string(2, LIST_TOP, "no agents", dim);
        }
        buf.set_string(area.width.saturating_sub(2), area.height - 1, "»", dim);
    }

    fn draw_agent_row(
        &self,
        buf: &mut Buffer,
        id: WindowId,
        space: usize,
        workspace: usize,
        y: u16,
        focused: bool,
    ) {
        let Some(window) = self.windows.get(&id) else {
            return;
        };
        let area = buf.area;
        let room = |x: u16| area.width.saturating_sub(x + 1) as usize;
        let base = if focused {
            Style::new().bg(theme::SURFACE0)
        } else {
            Style::new()
        };
        for line in [y, y + 1] {
            if line >= area.height.saturating_sub(1) {
                return;
            }
            for x in 1..area.width {
                buf[(x, line)].set_style(base);
            }
        }
        let (symbol, color) = glyph(window.tracker.status());
        buf.set_string(2, y, symbol, base.fg(color));
        let space_state = &self.model.spaces[space];
        let name_style = base
            .fg(if focused {
                theme::TEXT
            } else {
                theme::SUBTEXT0
            })
            .add_modifier(Modifier::BOLD);
        let (x, _) = buf.set_stringn(4, y, &space_state.name, room(4), name_style);
        // Like herdr's tab label: only when it tells workspaces apart.
        let ws = &space_state.workspaces[workspace];
        let occupied = space_state
            .workspaces
            .iter()
            .filter(|w| !w.is_empty())
            .count();
        let label = match &ws.name {
            Some(name) => Some(name.clone()),
            None if occupied > 1 => Some((workspace + 1).to_string()),
            None => None,
        };
        if let Some(label) = label {
            buf.set_stringn(
                x,
                y,
                format!(" · {label}"),
                room(x),
                base.fg(theme::OVERLAY0),
            );
        }
        let agent = window
            .name
            .clone()
            .or_else(|| window.tracker.agent().map(|a| a.name().to_owned()))
            .unwrap_or_default();
        buf.set_stringn(4, y + 1, agent, room(4), base.fg(theme::OVERLAY0));
    }
}
