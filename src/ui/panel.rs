//! The framed, opaque panel every overlay is drawn in.

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
        .border_style(Style::new().fg(theme::SURFACE1))
        .style(Style::new().bg(theme::BASE).fg(theme::TEXT));
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

/// A key shown boxed: `[x]` in the accent color.
pub fn key_style() -> Style {
    Style::new()
        .fg(theme::ACCENT)
        .bg(theme::SURFACE0)
        .add_modifier(Modifier::BOLD)
}
