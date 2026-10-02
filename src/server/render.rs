use std::time::Instant;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::widgets::{Clear, Widget};
use unicode_width::UnicodeWidthStr;

use super::{Server, chrome, inner, motion};
use crate::actions::Action;
use crate::detect::tracker::Status;
use crate::ui::output::Cursor;
use crate::ui::{terminal, theme};

pub fn frame(server: &Server, area: Rect) -> (Buffer, Option<Cursor>) {
    let now = Instant::now();
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
    if order.is_empty() {
        draw_empty_hint(server, area, &mut buf);
    }
    let ghost = server.drag_ghost();
    let mut order = order;
    if let Some((dragged, _)) = ghost {
        order.retain(|id| *id != dragged);
        order.push(dragged);
    }
    for id in order {
        let Some(window) = server.windows.get(&id) else {
            continue;
        };
        let rect = match ghost {
            Some((dragged, rect)) if dragged == id => rect,
            _ => motion::displayed(window.rect, window.slide, now),
        }
        .intersection(area);
        if rect.width < 2 || rect.height < 2 {
            continue;
        }
        let is_focused = focused == Some(id);
        let shimmer = (server.fades() && window.tracker.status() == Some(Status::Working))
            .then(|| motion::shimmer_phase(now, server.epoch));
        Clear.render(rect, &mut buf);
        chrome::draw(
            window,
            rect,
            is_focused,
            target == Some(id),
            server.mouse.hover_buttons == Some(id),
            shimmer,
            &mut buf,
        );
        let shown = terminal::draw(&window.pane.term, inner(rect), &mut buf);
        if is_focused {
            cursor = shown;
        }
    }

    if server.rename.is_some() {
        server.draw_rename(area, &mut buf);
        cursor = None;
    }
    if server.resize_mode {
        server.draw_resize_hint(area, &mut buf);
    }

    let layers = [
        server.overlay.as_ref().map(|o| o.opened),
        server.leader.as_ref().map(|l| l.opened),
        server.menu.as_ref().map(|m| m.opened),
    ];
    for (layer, opened) in layers.into_iter().enumerate() {
        let Some(opened) = opened else {
            continue;
        };
        cursor = None;
        let fading = server.fades() && now < opened + motion::FADE;
        let before = fading.then(|| buf.clone());
        match layer {
            0 => server.draw_overlay(area, &mut buf),
            1 => server.draw_leader(area, &mut buf),
            _ => server.draw_menu(&mut buf),
        }
        if let Some(before) = before {
            motion::fade(&before, &mut buf, opened, now);
        }
    }
    (buf, cursor)
}

/// Says how to open a window on an empty workspace.
fn draw_empty_hint(server: &Server, area: Rect, buf: &mut Buffer) {
    let key_for = |wanted: &Action| {
        server
            .keymap
            .listing
            .iter()
            .find(|(_, action)| action == wanted)
            .map(|(keys, _)| keys.clone())
    };
    let mut parts = Vec::new();
    if let Some(keys) = key_for(&Action::Spawn("terminal".into())) {
        parts.push(format!("{keys}  new terminal"));
    }
    if let Some(keys) = key_for(&Action::Palette) {
        parts.push(format!("{keys}  palette"));
    }
    let text = parts.join("   ·   ");
    let width = text.width() as u16;
    if width == 0 || width > area.width {
        return;
    }
    let x = area.x + (area.width - width) / 2;
    let y = area.y + area.height / 2;
    buf.set_string(x, y, text, Style::new().fg(theme::OVERLAY0));
}
