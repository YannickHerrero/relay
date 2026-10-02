//! Animations: windows sliding into their new place, overlays fading in and
//! the shimmer on working agents. Frames are only drawn while one runs.

use std::time::{Duration, Instant};

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Color;

use super::Server;
use crate::config::Motion;
use crate::detect::tracker::Status;
use crate::ui::theme;

pub const SLIDE: Duration = Duration::from_millis(140);
pub const FADE: Duration = Duration::from_millis(120);
const SHIMMER_PERIOD: Duration = Duration::from_millis(1600);
const SHIMMER_FRAME: Duration = Duration::from_millis(60);
pub const ANIMATION_FRAME: Duration = Duration::from_millis(16);

#[derive(Debug, Clone, Copy)]
pub struct Slide {
    pub from: Rect,
    pub start: Instant,
}

pub fn ease_out(t: f32) -> f32 {
    1.0 - (1.0 - t.clamp(0.0, 1.0)).powi(3)
}

pub fn progress(start: Instant, duration: Duration, now: Instant) -> f32 {
    now.saturating_duration_since(start).as_secs_f32() / duration.as_secs_f32()
}

pub fn lerp_rect(from: Rect, to: Rect, t: f32) -> Rect {
    let lerp = |a: u16, b: u16| (a as f32 + (b as f32 - a as f32) * t).round() as u16;
    Rect::new(
        lerp(from.x, to.x),
        lerp(from.y, to.y),
        lerp(from.width, to.width),
        lerp(from.height, to.height),
    )
}

/// Where a sliding window is drawn at `now`.
pub fn displayed(rect: Rect, slide: Option<Slide>, now: Instant) -> Rect {
    match slide {
        Some(s) if now < s.start + SLIDE => {
            lerp_rect(s.from, rect, ease_out(progress(s.start, SLIDE, now)))
        }
        _ => rect,
    }
}

/// A rectangle a third of `rect`'s size, centered in it: where a new window
/// grows from.
pub fn seed(rect: Rect) -> Rect {
    let (w, h) = (rect.width / 3, rect.height / 3);
    Rect::new(
        rect.x + (rect.width - w) / 2,
        rect.y + (rect.height - h) / 2,
        w,
        h,
    )
}

/// Fades the cells an overlay changed from what was under them.
pub fn fade(before: &Buffer, after: &mut Buffer, opened: Instant, now: Instant) {
    let t = ease_out(progress(opened, FADE, now));
    if t >= 1.0 {
        return;
    }
    let solid = |c: Color| if c == Color::Reset { theme::BASE } else { c };
    let area = after.area;
    for y in area.top()..area.bottom() {
        for x in area.left()..area.right() {
            let old = &before[(x, y)];
            let new = &after[(x, y)];
            if old == new {
                continue;
            }
            let fg = theme::blend(solid(old.bg), solid(new.fg), t);
            let bg = theme::blend(solid(old.bg), solid(new.bg), t);
            after[(x, y)].set_fg(fg).set_bg(bg);
        }
    }
}

/// Shimmer position in 0..1 at `now`.
pub fn shimmer_phase(now: Instant, epoch: Instant) -> f32 {
    let elapsed = now.saturating_duration_since(epoch).as_millis() % SHIMMER_PERIOD.as_millis();
    elapsed as f32 / SHIMMER_PERIOD.as_millis() as f32
}

impl Server {
    pub(super) fn slides(&self) -> bool {
        self.config.motion != Motion::None
    }

    pub(super) fn fades(&self) -> bool {
        self.config.motion == Motion::Full
    }

    /// How soon the next animation frame is due, if anything moves.
    pub(super) fn next_animation(&self, now: Instant) -> Option<Duration> {
        let sliding = self
            .windows
            .values()
            .any(|w| w.slide.is_some_and(|s| now < s.start + SLIDE));
        let opened = [
            self.overlay.as_ref().map(|o| o.opened),
            self.leader.as_ref().map(|l| l.opened),
            self.menu.as_ref().map(|m| m.opened),
        ];
        let fading = self.fades() && opened.into_iter().flatten().any(|t| now < t + FADE);
        if sliding || fading || self.sidebar_sliding(now) {
            return Some(ANIMATION_FRAME);
        }
        let shimmering = self.fades()
            && self.client.is_some()
            && self.model.workspace().windows().any(|id| {
                self.windows
                    .get(&id)
                    .is_some_and(|w| w.tracker.status() == Some(Status::Working))
            });
        let shimmer = shimmering.then_some(SHIMMER_FRAME);
        match (shimmer, self.toast_expiry(now)) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slide_ends_on_the_target() {
        let start = Instant::now();
        let slide = Some(Slide {
            from: Rect::new(0, 0, 10, 10),
            start,
        });
        let to = Rect::new(20, 0, 10, 10);
        assert_eq!(displayed(to, slide, start), Rect::new(0, 0, 10, 10));
        assert_eq!(displayed(to, slide, start + SLIDE), to);
        let mid = displayed(to, slide, start + SLIDE / 2);
        assert!(mid.x > 10 && mid.x < 20);
    }

    #[test]
    fn seed_is_centered() {
        assert_eq!(seed(Rect::new(0, 0, 30, 9)), Rect::new(10, 3, 10, 3));
    }

    #[test]
    fn shimmer_phase_wraps() {
        let epoch = Instant::now();
        assert!(shimmer_phase(epoch + SHIMMER_PERIOD / 2, epoch) > 0.4);
        assert!(shimmer_phase(epoch + SHIMMER_PERIOD, epoch) < 0.01);
    }
}
