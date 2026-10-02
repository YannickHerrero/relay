use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::widgets::{Block, BorderType, Clear, Widget};

use super::{Server, inner};
use crate::ui::output::Cursor;
use crate::ui::{terminal, theme};

pub fn frame(server: &Server, area: Rect) -> (Buffer, Option<Cursor>) {
    let mut buf = Buffer::empty(area);
    server.draw_bar(Rect::new(area.x, area.y, area.width, 1), &mut buf);
    let ws = server.model.workspace();
    let focused = ws.focused;
    let mut cursor = None;
    let order: Vec<_> = match ws.fullscreen {
        Some(id) => vec![id],
        None => ws.windows().collect(),
    };
    for id in order {
        let Some(window) = server.windows.get(&id) else {
            continue;
        };
        let rect = window.rect.intersection(area);
        if rect.is_empty() {
            continue;
        }
        let is_focused = focused == Some(id);
        Clear.render(rect, &mut buf);
        let border = if is_focused {
            theme::ACCENT
        } else {
            theme::SURFACE1
        };
        Block::bordered()
            .border_type(BorderType::Rounded)
            .border_style(Style::new().fg(border))
            .render(rect, &mut buf);
        let shown = terminal::draw(&window.pane.term, inner(window.rect), &mut buf);
        if is_focused {
            cursor = shown;
        }
    }
    (buf, cursor)
}
