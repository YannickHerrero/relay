use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::widgets::{Clear, Widget};

use super::{Server, chrome, inner};
use crate::ui::output::Cursor;
use crate::ui::terminal;

pub fn frame(server: &Server, area: Rect) -> (Buffer, Option<Cursor>) {
    let mut buf = Buffer::empty(area);
    server.draw_bar(Rect::new(area.x, area.y, area.width, 1), &mut buf);
    let ws = server.model.workspace();
    let focused = ws.focused;
    let mut cursor = None;
    let target = server.drop_target();
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
        chrome::draw(
            window,
            window.rect,
            is_focused,
            target == Some(id),
            None,
            &mut buf,
        );
        let shown = terminal::draw(&window.pane.term, inner(window.rect), &mut buf);
        if is_focused {
            cursor = shown;
        }
    }
    if server.overlay.is_some() {
        server.draw_overlay(area, &mut buf);
        cursor = None;
    }
    if server.leader.is_some() {
        server.draw_leader(area, &mut buf);
        cursor = None;
    }
    (buf, cursor)
}
