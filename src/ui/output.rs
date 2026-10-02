//! Encodes rendered frames as the ANSI a client terminal needs, sending only
//! the cells that changed since the previous frame.

use std::io::Write;

use crossterm::cursor::{Hide, MoveTo, SetCursorStyle, Show};
use crossterm::queue;
use ratatui::backend::{Backend, CrosstermBackend};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cursor {
    pub x: u16,
    pub y: u16,
    pub style: SetCursorStyle,
}

pub struct Output {
    previous: Option<Buffer>,
}

impl Output {
    pub fn new() -> Output {
        Output { previous: None }
    }

    /// Forgets what the client shows, so the next frame is drawn in full.
    pub fn invalidate(&mut self) {
        self.previous = None;
    }

    pub fn encode(&mut self, frame: &Buffer, cursor: Option<Cursor>) -> Vec<u8> {
        let mut out = Vec::new();
        // Synchronized output: the terminal shows the frame all at once.
        out.extend_from_slice(b"\x1b[?2026h");
        let _ = queue!(out, Hide);
        let full;
        let previous = match &self.previous {
            Some(p) if p.area == frame.area => p,
            _ => {
                out.extend_from_slice(b"\x1b[0m\x1b[2J");
                full = Buffer::empty(Rect::new(0, 0, frame.area.width, frame.area.height));
                &full
            }
        };
        {
            let mut backend = CrosstermBackend::new(&mut out);
            let _ = backend.draw(previous.diff(frame).into_iter());
        }
        if let Some(cursor) = cursor {
            let _ = queue!(out, MoveTo(cursor.x, cursor.y), cursor.style, Show);
        }
        out.extend_from_slice(b"\x1b[?2026l");
        let _ = out.flush();
        self.previous = Some(frame.clone());
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).into_owned()
    }

    #[test]
    fn first_frame_clears_and_draws_everything() {
        let mut output = Output::new();
        let mut frame = Buffer::empty(Rect::new(0, 0, 4, 1));
        frame.set_string(0, 0, "ab", ratatui::style::Style::default());
        let out = text(&output.encode(&frame, None));
        assert!(out.contains("\x1b[2J"));
        assert!(out.contains("ab"));
    }

    #[test]
    fn next_frame_sends_only_changes() {
        let mut output = Output::new();
        let mut frame = Buffer::empty(Rect::new(0, 0, 4, 1));
        frame.set_string(0, 0, "ab", ratatui::style::Style::default());
        output.encode(&frame, None);
        frame.set_string(3, 0, "z", ratatui::style::Style::default());
        let out = text(&output.encode(&frame, None));
        assert!(!out.contains("ab"));
        assert!(out.contains('z'));
        assert!(!out.contains("\x1b[2J"));
    }
}
