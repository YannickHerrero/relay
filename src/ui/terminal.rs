//! Draws an emulated terminal screen into a frame.

use alacritty_terminal::event::EventListener;
use alacritty_terminal::term::Term;
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::vte::ansi::{self, CursorShape, NamedColor};
use crossterm::cursor::SetCursorStyle;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier};

use super::output::Cursor;

/// Default foreground and background stay `Reset` and the 16 ANSI colors
/// stay indexed, so the client terminal's own theme shows through.
fn color(c: ansi::Color) -> (Color, bool) {
    match c {
        ansi::Color::Spec(rgb) => (Color::Rgb(rgb.r, rgb.g, rgb.b), false),
        ansi::Color::Indexed(i) => (Color::Indexed(i), false),
        ansi::Color::Named(named) => {
            let n = named as usize;
            match named {
                _ if n < 16 => (Color::Indexed(n as u8), false),
                NamedColor::DimBlack
                | NamedColor::DimRed
                | NamedColor::DimGreen
                | NamedColor::DimYellow
                | NamedColor::DimBlue
                | NamedColor::DimMagenta
                | NamedColor::DimCyan
                | NamedColor::DimWhite => (
                    Color::Indexed((n - NamedColor::DimBlack as usize) as u8),
                    true,
                ),
                NamedColor::DimForeground => (Color::Reset, true),
                _ => (Color::Reset, false),
            }
        }
    }
}

/// Draws `term` into `area` of `buf`, clipped, and returns where its cursor
/// should be shown, if anywhere.
pub fn draw<T: EventListener>(term: &Term<T>, area: Rect, buf: &mut Buffer) -> Option<Cursor> {
    let content = term.renderable_content();
    let offset = content.display_offset as i32;
    let selection = content.selection;
    let visible = area.intersection(buf.area);
    for indexed in content.display_iter {
        let row = indexed.point.line.0 + offset;
        let col = indexed.point.column.0 as i32;
        if row < 0 || row >= area.height as i32 || col >= area.width as i32 {
            continue;
        }
        let (x, y) = (area.x + col as u16, area.y + row as u16);
        if !visible.contains((x, y).into()) {
            continue;
        }
        let cell = &*indexed;
        let target = &mut buf[(x, y)];
        if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
            target.reset();
            continue;
        }
        let (mut fg, dim) = color(cell.fg);
        let (mut bg, _) = color(cell.bg);
        let mut modifier = Modifier::empty();
        for (flag, m) in [
            (Flags::BOLD, Modifier::BOLD),
            (Flags::ITALIC, Modifier::ITALIC),
            (Flags::DIM, Modifier::DIM),
            (Flags::HIDDEN, Modifier::HIDDEN),
            (Flags::STRIKEOUT, Modifier::CROSSED_OUT),
        ] {
            if cell.flags.contains(flag) {
                modifier |= m;
            }
        }
        if cell.flags.intersects(Flags::ALL_UNDERLINES) {
            modifier |= Modifier::UNDERLINED;
        }
        if dim {
            modifier |= Modifier::DIM;
        }
        let selected = selection.is_some_and(|s| s.contains(indexed.point));
        if cell.flags.contains(Flags::INVERSE) != selected {
            if fg == Color::Reset && bg == Color::Reset {
                modifier |= Modifier::REVERSED;
            } else {
                std::mem::swap(&mut fg, &mut bg);
                if fg == Color::Reset {
                    fg = Color::Black;
                }
                if bg == Color::Reset {
                    bg = Color::White;
                }
            }
        }
        let mut symbol = String::new();
        symbol.push(if cell.c == '\0' { ' ' } else { cell.c });
        if let Some(zw) = cell.zerowidth() {
            symbol.extend(zw);
        }
        target.set_symbol(&symbol);
        target.fg = fg;
        target.bg = bg;
        target.modifier = modifier;
    }

    let cursor = content.cursor;
    if cursor.shape == CursorShape::Hidden || offset != 0 {
        return None;
    }
    let (x, y) = (
        area.x + cursor.point.column.0 as u16,
        area.y.checked_add_signed(cursor.point.line.0 as i16)?,
    );
    if !visible.contains((x, y).into()) {
        return None;
    }
    let blinking = term.cursor_style().blinking;
    let style = match (cursor.shape, blinking) {
        (CursorShape::Underline, true) => SetCursorStyle::BlinkingUnderScore,
        (CursorShape::Underline, false) => SetCursorStyle::SteadyUnderScore,
        (CursorShape::Beam, true) => SetCursorStyle::BlinkingBar,
        (CursorShape::Beam, false) => SetCursorStyle::SteadyBar,
        (_, true) => SetCursorStyle::BlinkingBlock,
        (_, false) => SetCursorStyle::SteadyBlock,
    };
    Some(Cursor { x, y, style })
}

#[cfg(test)]
mod tests {
    use super::*;
    use alacritty_terminal::event::VoidListener;
    use alacritty_terminal::term::{Config, test::TermSize};

    fn term(bytes: &[u8]) -> Term<VoidListener> {
        let mut term = Term::new(Config::default(), &TermSize::new(10, 3), VoidListener);
        ansi::Processor::<ansi::StdSyncHandler>::new().advance(&mut term, bytes);
        term
    }

    #[test]
    fn draws_text_with_colors_at_an_offset() {
        let term = term(b"\x1b[31mhi\x1b[0m ok");
        let mut buf = Buffer::empty(Rect::new(0, 0, 20, 5));
        let cursor = draw(&term, Rect::new(2, 1, 10, 3), &mut buf);
        assert_eq!(buf[(2, 1)].symbol(), "h");
        assert_eq!(buf[(2, 1)].fg, Color::Indexed(1));
        assert_eq!(buf[(5, 1)].symbol(), "o");
        assert_eq!(buf[(5, 1)].fg, Color::Reset);
        assert_eq!(cursor.map(|c| (c.x, c.y)), Some((7, 1)));
    }

    #[test]
    fn clips_to_the_frame() {
        let term = term(b"abcdefghij");
        let mut buf = Buffer::empty(Rect::new(0, 0, 4, 1));
        draw(&term, Rect::new(0, 0, 10, 3), &mut buf);
        assert_eq!(buf[(3, 0)].symbol(), "d");
    }

    #[test]
    fn hidden_cursor_is_not_shown() {
        let term = term(b"\x1b[?25l");
        let mut buf = Buffer::empty(Rect::new(0, 0, 10, 3));
        assert!(draw(&term, Rect::new(0, 0, 10, 3), &mut buf).is_none());
    }
}
