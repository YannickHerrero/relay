//! Turns keyboard, mouse and paste events back into the bytes a program in a
//! terminal expects, according to the modes it enabled.

use alacritty_terminal::term::TermMode;
use crossterm::event::{
    KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEventKind,
};

fn modifier_param(mods: KeyModifiers) -> u8 {
    1 + mods.contains(KeyModifiers::SHIFT) as u8
        + 2 * mods.contains(KeyModifiers::ALT) as u8
        + 4 * mods.contains(KeyModifiers::CONTROL) as u8
}

pub fn key(event: &KeyEvent, mode: TermMode) -> Vec<u8> {
    if event.kind == KeyEventKind::Release {
        return Vec::new();
    }
    let mods = event.modifiers;
    let kitty = mode.contains(TermMode::DISAMBIGUATE_ESC_CODES);
    let ctrl = mods.contains(KeyModifiers::CONTROL);
    let alt = mods.contains(KeyModifiers::ALT);
    let shift = mods.contains(KeyModifiers::SHIFT);
    let param = modifier_param(mods);
    let csi_u = |code: u32| format!("\x1b[{code};{param}u").into_bytes();
    let with_alt = |bytes: Vec<u8>| {
        if alt {
            let mut out = vec![0x1b];
            out.extend(bytes);
            out
        } else {
            bytes
        }
    };
    let cursor = |letter: char| {
        if param > 1 {
            format!("\x1b[1;{param}{letter}").into_bytes()
        } else if mode.contains(TermMode::APP_CURSOR) {
            format!("\x1bO{letter}").into_bytes()
        } else {
            format!("\x1b[{letter}").into_bytes()
        }
    };
    let tilde = |code: u8| {
        if param > 1 {
            format!("\x1b[{code};{param}~").into_bytes()
        } else {
            format!("\x1b[{code}~").into_bytes()
        }
    };
    match event.code {
        KeyCode::Char(c) if kitty && (ctrl || alt) => {
            csi_u(c.to_lowercase().next().unwrap_or(c) as u32)
        }
        KeyCode::Char(c) if ctrl => with_alt(vec![ctrl_byte(c)]),
        KeyCode::Char(c) => with_alt(c.to_string().into_bytes()),
        KeyCode::Enter if kitty && param > 1 => csi_u(13),
        KeyCode::Enter => with_alt(vec![b'\r']),
        KeyCode::Tab if kitty && (ctrl || alt) => csi_u(9),
        KeyCode::Tab if shift => b"\x1b[Z".to_vec(),
        KeyCode::Tab => with_alt(vec![b'\t']),
        KeyCode::BackTab => b"\x1b[Z".to_vec(),
        KeyCode::Backspace if kitty && param > 1 => csi_u(127),
        KeyCode::Backspace if ctrl => with_alt(vec![0x08]),
        KeyCode::Backspace => with_alt(vec![0x7f]),
        KeyCode::Esc if kitty => csi_u(27),
        KeyCode::Esc => with_alt(vec![0x1b]),
        KeyCode::Up => cursor('A'),
        KeyCode::Down => cursor('B'),
        KeyCode::Right => cursor('C'),
        KeyCode::Left => cursor('D'),
        KeyCode::Home => cursor('H'),
        KeyCode::End => cursor('F'),
        KeyCode::Insert => tilde(2),
        KeyCode::Delete => tilde(3),
        KeyCode::PageUp => tilde(5),
        KeyCode::PageDown => tilde(6),
        KeyCode::F(n @ 1..=4) => {
            let letter = (b'P' + n - 1) as char;
            if param > 1 {
                format!("\x1b[1;{param}{letter}").into_bytes()
            } else {
                format!("\x1bO{letter}").into_bytes()
            }
        }
        KeyCode::F(n @ 5..=12) => tilde([15, 17, 18, 19, 20, 21, 23, 24][n as usize - 5]),
        _ => Vec::new(),
    }
}

fn ctrl_byte(c: char) -> u8 {
    match c {
        'a'..='z' => c as u8 - b'a' + 1,
        'A'..='Z' => c as u8 - b'A' + 1,
        ' ' | '@' | '2' => 0,
        '[' | '3' => 0x1b,
        '\\' | '4' => 0x1c,
        ']' | '5' => 0x1d,
        '^' | '6' => 0x1e,
        '_' | '/' | '7' => 0x1f,
        '?' | '8' => 0x7f,
        other => other as u8,
    }
}

pub fn paste(text: &str, mode: TermMode) -> Vec<u8> {
    if mode.contains(TermMode::BRACKETED_PASTE) {
        let clean = text.replace("\x1b[201~", "");
        format!("\x1b[200~{clean}\x1b[201~").into_bytes()
    } else {
        text.replace("\r\n", "\r").replace('\n', "\r").into_bytes()
    }
}

/// Mouse event at (`col`, `row`) inside the pane, for a program that asked
/// for mouse reports. Empty when its mode does not cover this event.
pub fn mouse(
    kind: MouseEventKind,
    mods: KeyModifiers,
    col: u16,
    row: u16,
    mode: TermMode,
) -> Vec<u8> {
    let button_code = |b: MouseButton| match b {
        MouseButton::Left => 0,
        MouseButton::Middle => 1,
        MouseButton::Right => 2,
    };
    let (code, release) = match kind {
        MouseEventKind::Down(b) => (button_code(b), false),
        MouseEventKind::Up(b) => (button_code(b), true),
        MouseEventKind::Drag(b)
            if mode.intersects(TermMode::MOUSE_DRAG | TermMode::MOUSE_MOTION) =>
        {
            (button_code(b) + 32, false)
        }
        MouseEventKind::Moved if mode.contains(TermMode::MOUSE_MOTION) => (3 + 32, false),
        MouseEventKind::ScrollUp => (64, false),
        MouseEventKind::ScrollDown => (65, false),
        _ => return Vec::new(),
    };
    let code = code
        + 4 * mods.contains(KeyModifiers::SHIFT) as u8
        + 8 * mods.contains(KeyModifiers::ALT) as u8
        + 16 * mods.contains(KeyModifiers::CONTROL) as u8;
    if mode.contains(TermMode::SGR_MOUSE) {
        let end = if release { 'm' } else { 'M' };
        return format!("\x1b[<{code};{};{}{end}", col + 1, row + 1).into_bytes();
    }
    let code = if release { 3 } else { code };
    let clamp = |v: u16| (v + 1).min(223) as u8 + 32;
    vec![0x1b, b'[', b'M', 32 + code, clamp(col), clamp(row)]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn press(code: KeyCode, mods: KeyModifiers) -> KeyEvent {
        KeyEvent::new(code, mods)
    }

    #[test]
    fn plain_and_control_characters() {
        let none = TermMode::empty();
        assert_eq!(
            key(&press(KeyCode::Char('a'), KeyModifiers::NONE), none),
            b"a"
        );
        assert_eq!(
            key(&press(KeyCode::Char('c'), KeyModifiers::CONTROL), none),
            [3]
        );
        assert_eq!(
            key(&press(KeyCode::Char('b'), KeyModifiers::ALT), none),
            b"\x1bb"
        );
        assert_eq!(
            key(&press(KeyCode::Char('é'), KeyModifiers::NONE), none),
            "é".as_bytes()
        );
    }

    #[test]
    fn arrows_follow_application_cursor_mode() {
        let up = press(KeyCode::Up, KeyModifiers::NONE);
        assert_eq!(key(&up, TermMode::empty()), b"\x1b[A");
        assert_eq!(key(&up, TermMode::APP_CURSOR), b"\x1bOA");
        assert_eq!(
            key(
                &press(KeyCode::Up, KeyModifiers::CONTROL),
                TermMode::APP_CURSOR
            ),
            b"\x1b[1;5A"
        );
    }

    #[test]
    fn kitty_mode_disambiguates_modified_keys() {
        let kitty = TermMode::DISAMBIGUATE_ESC_CODES;
        assert_eq!(
            key(&press(KeyCode::Enter, KeyModifiers::SHIFT), kitty),
            b"\x1b[13;2u"
        );
        assert_eq!(
            key(&press(KeyCode::Char('i'), KeyModifiers::CONTROL), kitty),
            b"\x1b[105;5u"
        );
        assert_eq!(
            key(&press(KeyCode::Enter, KeyModifiers::NONE), kitty),
            b"\r"
        );
    }

    #[test]
    fn function_and_editing_keys() {
        let none = TermMode::empty();
        assert_eq!(
            key(&press(KeyCode::F(1), KeyModifiers::NONE), none),
            b"\x1bOP"
        );
        assert_eq!(
            key(&press(KeyCode::F(5), KeyModifiers::NONE), none),
            b"\x1b[15~"
        );
        assert_eq!(
            key(&press(KeyCode::Delete, KeyModifiers::SHIFT), none),
            b"\x1b[3;2~"
        );
        assert_eq!(
            key(&press(KeyCode::BackTab, KeyModifiers::SHIFT), none),
            b"\x1b[Z"
        );
    }

    #[test]
    fn paste_is_bracketed_when_asked() {
        assert_eq!(paste("a\nb", TermMode::empty()), b"a\rb");
        assert_eq!(
            paste("x", TermMode::BRACKETED_PASTE),
            b"\x1b[200~x\x1b[201~"
        );
    }

    #[test]
    fn sgr_mouse_reports() {
        let mode = TermMode::MOUSE_REPORT_CLICK | TermMode::SGR_MOUSE;
        let down = mouse(
            MouseEventKind::Down(MouseButton::Left),
            KeyModifiers::NONE,
            4,
            2,
            mode,
        );
        assert_eq!(down, b"\x1b[<0;5;3M");
        let up = mouse(
            MouseEventKind::Up(MouseButton::Left),
            KeyModifiers::NONE,
            4,
            2,
            mode,
        );
        assert_eq!(up, b"\x1b[<0;5;3m");
        let moved = mouse(MouseEventKind::Moved, KeyModifiers::NONE, 4, 2, mode);
        assert!(moved.is_empty());
    }
}
