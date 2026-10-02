//! Window decoration: rounded border, title and agent badge in the top
//! border, and the float / zoom / close buttons.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::widgets::{Block, BorderType, Widget};
use unicode_width::UnicodeWidthStr;

use super::Window;
use super::bar::status_style;
use crate::detect::tracker::Status;
use crate::ui::theme;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Button {
    Float,
    Zoom,
    Close,
}

/// Each button is a colored dot that shows its symbol while hovered.
const BUTTONS: [(Button, ratatui::style::Color, &str); 3] = [
    (Button::Float, theme::YELLOW, "^"),
    (Button::Zoom, theme::GREEN, "+"),
    (Button::Close, theme::RED, "×"),
];
/// Narrower windows show no buttons.
const BUTTONS_MIN_WIDTH: u16 = 24;

/// Column of the first button: ` ● ● ● ─╮` ends the top border.
fn buttons_x(rect: Rect) -> Option<u16> {
    (rect.width >= BUTTONS_MIN_WIDTH).then(|| rect.x + rect.width - 9)
}

pub fn button_at(rect: Rect, x: u16, y: u16) -> Option<Button> {
    if y != rect.y {
        return None;
    }
    let bx = buttons_x(rect)?;
    BUTTONS
        .iter()
        .enumerate()
        .find(|(i, _)| {
            let dot = bx + 1 + 2 * *i as u16;
            x == dot || x == dot + 1
        })
        .map(|(_, (b, _, _))| *b)
}

/// The title a window shows: its terminal title without a leading spinner,
/// else its agent, else `shell`.
pub fn title(window: &Window) -> String {
    if let Some(name) = &window.name {
        return name.clone();
    }
    let raw = window.pane.title.trim();
    let mut chars = raw.chars();
    let stripped = match chars.next() {
        Some(c) if !c.is_alphanumeric() && raw[c.len_utf8()..].starts_with(' ') => {
            chars.as_str().trim()
        }
        _ => raw,
    };
    if !stripped.is_empty() {
        return stripped.to_owned();
    }
    match window.tracker.agent() {
        Some(agent) => agent.name().to_owned(),
        None if window.popup => "popup".to_owned(),
        None => "shell".to_owned(),
    }
}

pub fn draw(
    window: &Window,
    rect: Rect,
    focused: bool,
    highlight: bool,
    hover: bool,
    shimmer: Option<f32>,
    buf: &mut Buffer,
) {
    let status = window.tracker.status();
    let border = match (focused, status) {
        _ if highlight => theme::BLUE,
        (true, _) => theme::ACCENT,
        (false, Some(Status::Blocked)) => theme::PEACH,
        _ => theme::SURFACE1,
    };
    Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(border))
        .render(rect, buf);
    if rect.width < 6 {
        return;
    }

    let mut right_edge = rect.x + rect.width - 2;
    if let Some(bx) = buttons_x(rect) {
        for (i, (_, color, symbol)) in BUTTONS.iter().enumerate() {
            let dot = bx + 1 + 2 * i as u16;
            if hover {
                let style = Style::new()
                    .fg(theme::BASE)
                    .bg(*color)
                    .add_modifier(Modifier::BOLD);
                buf.set_string(dot, rect.y, *symbol, style);
            } else {
                buf.set_string(dot, rect.y, "●", Style::new().fg(*color));
            }
            buf.set_string(dot + 1, rect.y, " ", Style::new());
        }
        buf.set_string(bx, rect.y, " ", Style::new());
        right_edge = bx - 1;
    }

    if let Some(status) = status
        && status != Status::Unknown
    {
        let (label, style) = status_style(status);
        let text = format!(" ● {label} ");
        let w = text.width() as u16;
        if right_edge > rect.x + w + 4 {
            let x = right_edge - w;
            buf.set_string(x, rect.y, &text, style);
            if let Some(phase) = shimmer {
                shimmer_cells(buf, x + 3, rect.y, label.width() as u16, phase);
            }
            right_edge = x - 1;
        }
    }

    // Only a name the user gave is shown; unnamed windows keep a bare border.
    let max = right_edge.saturating_sub(rect.x + 3) as usize;
    if let Some(name) = window.name.as_deref()
        && max > 2
    {
        let title = truncate(name, max - 2);
        let style = if focused {
            Style::new().fg(theme::TEXT).add_modifier(Modifier::BOLD)
        } else {
            Style::new().fg(theme::SUBTEXT0)
        };
        buf.set_string(rect.x + 2, rect.y, format!(" {title} "), style);
    }
}

/// Brightens a narrow band moving across `width` cells; `phase` in 0..1.
fn shimmer_cells(buf: &mut Buffer, x: u16, y: u16, width: u16, phase: f32) {
    let center = phase * (width as f32 + 6.0) - 3.0;
    for i in 0..width {
        if (i as f32 - center).abs() < 1.5 {
            let cell = &mut buf[(x + i, y)];
            cell.modifier.insert(Modifier::BOLD);
            cell.fg = theme::TEXT;
        }
    }
}

fn truncate(text: &str, max: usize) -> String {
    if text.width() <= max {
        return text.to_owned();
    }
    let mut out = String::new();
    for c in text.chars() {
        if out.width() + 2 > max {
            break;
        }
        out.push(c);
    }
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buttons_sit_before_the_top_right_corner() {
        let rect = Rect::new(0, 1, 40, 10);
        assert_eq!(button_at(rect, 32, 1), Some(Button::Float));
        assert_eq!(button_at(rect, 34, 1), Some(Button::Zoom));
        assert_eq!(button_at(rect, 36, 1), Some(Button::Close));
        assert_eq!(button_at(rect, 36, 2), None);
        assert_eq!(button_at(Rect::new(0, 0, 20, 5), 15, 0), None);
    }

    #[test]
    fn truncate_adds_an_ellipsis() {
        assert_eq!(truncate("hello", 10), "hello");
        assert_eq!(truncate("hello world", 6), "hello…");
    }
}
