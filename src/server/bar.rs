//! The status bar: space and workspaces on the left, date and time in the
//! middle, agents on the right.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use unicode_width::UnicodeWidthStr;

use super::Server;
use crate::detect::tracker::Status;
use crate::model::WORKSPACES;
use crate::ui::theme;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BarItem {
    Space,
    Workspace(usize),
}

pub struct Segment {
    pub x: u16,
    pub text: String,
    pub style: Style,
    pub item: Option<BarItem>,
}

/// Worst agent status of a set of windows, for a workspace marker.
pub fn rollup(statuses: impl Iterator<Item = Status>) -> Option<Status> {
    statuses.min_by_key(|s| match s {
        Status::Blocked => 0,
        Status::Done => 1,
        Status::Working => 2,
        Status::Idle => 3,
        Status::Unknown => 4,
    })
}

pub fn status_style(status: Status) -> (&'static str, Style) {
    match status {
        Status::Working => ("working", Style::new().fg(theme::MAUVE)),
        Status::Blocked => (
            "needs you",
            Style::new().fg(theme::PEACH).add_modifier(Modifier::BOLD),
        ),
        Status::Done => ("done", Style::new().fg(theme::GREEN)),
        Status::Idle => ("idle", Style::new().fg(theme::OVERLAY0)),
        Status::Unknown => ("", Style::new().fg(theme::OVERLAY0)),
    }
}

impl Server {
    pub(super) fn bar_segments(&self, width: u16) -> Vec<Segment> {
        let mut segments = Vec::new();
        let space = self.model.space();
        let mut x = 0u16;
        let push = |segments: &mut Vec<Segment>, x: &mut u16, text: String, style: Style, item| {
            let w = text.width() as u16;
            segments.push(Segment {
                x: *x,
                text,
                style,
                item,
            });
            *x += w;
        };

        push(
            &mut segments,
            &mut x,
            format!(" {} ", space.name),
            Style::new()
                .fg(theme::BASE)
                .bg(theme::MAUVE)
                .add_modifier(Modifier::BOLD),
            Some(BarItem::Space),
        );
        x += 1;
        for n in 0..WORKSPACES {
            let ws = &space.workspaces[n];
            let active = n == space.active;
            if ws.is_empty() && !active {
                continue;
            }
            let status = rollup(
                ws.windows()
                    .filter_map(|id| self.windows.get(&id)?.tracker.status()),
            );
            let style = if active {
                Style::new()
                    .fg(theme::BASE)
                    .bg(theme::BLUE)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::new().fg(theme::SURFACE_TEXT).bg(theme::SURFACE0)
            };
            let label = match &ws.name {
                Some(name) => format!(" {} - {name} ", n + 1),
                None => format!(" {} ", n + 1),
            };
            push(
                &mut segments,
                &mut x,
                label,
                style,
                Some(BarItem::Workspace(n)),
            );
            // The same dot as the agent counts on the right.
            if let Some(status @ (Status::Working | Status::Blocked | Status::Done)) = status {
                let (_, dot) = status_style(status);
                let dot = style.fg(dot.fg.unwrap_or(theme::TEXT));
                push(
                    &mut segments,
                    &mut x,
                    "● ".to_owned(),
                    dot,
                    Some(BarItem::Workspace(n)),
                );
            }
            x += 1;
        }

        let clock = chrono::Local::now().format("%a %d %b  %H:%M").to_string();
        let clock_x = (width.saturating_sub(clock.width() as u16)) / 2;
        if clock_x > x {
            segments.push(Segment {
                x: clock_x,
                text: clock,
                style: Style::new().fg(theme::TEXT),
                item: None,
            });
        }

        let mut counts = [0usize; 3];
        for window in self.windows.values() {
            match window.tracker.status() {
                Some(Status::Working) => counts[0] += 1,
                Some(Status::Blocked) => counts[1] += 1,
                Some(Status::Done) => counts[2] += 1,
                _ => {}
            }
        }
        let mut right: Vec<(String, Style)> = Vec::new();
        for (count, status) in
            counts
                .into_iter()
                .zip([Status::Working, Status::Blocked, Status::Done])
        {
            if count > 0 {
                let (label, style) = status_style(status);
                right.push((format!("● {count} {label}"), style));
            }
        }
        let total: u16 = right.iter().map(|(t, _)| t.width() as u16 + 2).sum();
        let mut rx = width.saturating_sub(total);
        for (text, style) in right {
            let w = text.width() as u16;
            segments.push(Segment {
                x: rx,
                text,
                style,
                item: None,
            });
            rx += w + 2;
        }
        segments
    }

    pub(super) fn draw_bar(&self, area: Rect, buf: &mut Buffer) {
        for segment in self.bar_segments(area.width) {
            buf.set_stringn(
                area.x + segment.x,
                area.y,
                &segment.text,
                area.width.saturating_sub(segment.x) as usize,
                segment.style,
            );
        }
    }

    pub(super) fn bar_item_at(&self, col: u16) -> Option<BarItem> {
        self.bar_segments(self.size.0 - self.sidebar_width())
            .into_iter()
            .find(|s| col >= s.x && col < s.x + s.text.width() as u16)
            .and_then(|s| s.item)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rollup_prefers_blocked() {
        let statuses = [Status::Idle, Status::Working, Status::Blocked];
        assert_eq!(rollup(statuses.into_iter()), Some(Status::Blocked));
        assert_eq!(rollup(std::iter::empty()), None);
    }
}
