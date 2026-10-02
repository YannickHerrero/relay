//! Short confirmations shown bottom right, such as a copied selection.

use std::time::{Duration, Instant};

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use unicode_width::UnicodeWidthStr;

use super::Server;
use crate::ui::{panel, theme};

pub const TOAST: Duration = Duration::from_millis(1500);

#[derive(Debug, Clone)]
pub struct Toast {
    pub text: String,
    pub shown: Instant,
}

impl Server {
    pub(super) fn toast(&mut self, text: impl Into<String>) {
        self.toast = Some(Toast {
            text: text.into(),
            shown: Instant::now(),
        });
        self.dirty = true;
    }

    /// When the visible toast must disappear.
    pub(super) fn toast_expiry(&self, now: Instant) -> Option<Duration> {
        let toast = self.toast.as_ref()?;
        let end = toast.shown + TOAST;
        (now < end).then(|| end - now)
    }

    pub(super) fn draw_toast(&self, area: Rect, buf: &mut Buffer, now: Instant) {
        let Some(toast) = self.toast.as_ref().filter(|t| now < t.shown + TOAST) else {
            return;
        };
        let width = (toast.text.width() as u16 + 4).min(area.width);
        let rect = Rect::new(
            area.x + area.width.saturating_sub(width + 1),
            area.y + area.height.saturating_sub(4),
            width,
            3,
        );
        let inner = panel::draw(rect, "", "", buf);
        buf.set_stringn(
            inner.x + 1,
            inner.y,
            &toast.text,
            inner.width.saturating_sub(1) as usize,
            Style::new().fg(theme::GREEN),
        );
    }
}
