//! The frame every overlay is drawn in: what is under it is cleared, and
//! the terminal's own background shows through, as in a floating window.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::Line;
use ratatui::widgets::{Block, BorderType, Clear, Widget};

use super::theme;

/// Draws a panel and returns its inner area.
pub fn draw(rect: Rect, title: &str, footer: &str, buf: &mut Buffer) -> Rect {
    Clear.render(rect, buf);
    let mut block = Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(theme::SURFACE1));
    if !title.is_empty() {
        block = block.title(Line::styled(
            format!(" {title} "),
            Style::new().fg(theme::ACCENT).add_modifier(Modifier::BOLD),
        ));
    }
    if !footer.is_empty() {
        block = block.title_bottom(
            Line::styled(format!(" {footer} "), Style::new().fg(theme::OVERLAY0)).right_aligned(),
        );
    }
    let inner = block.inner(rect);
    block.render(rect, buf);
    inner
}

/// A key, in the accent color.
pub fn key_style() -> Style {
    Style::new().fg(theme::ACCENT).add_modifier(Modifier::BOLD)
}
