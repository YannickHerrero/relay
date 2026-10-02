//! Key chords written the way Illium writes them: `Ctrl+Shift+H`, `Alt+1`.

use std::fmt;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Mods {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Key {
    /// Letters are stored lowercase; Shift is a modifier.
    Char(char),
    Enter,
    Tab,
    Backspace,
    Esc,
    Space,
    Up,
    Down,
    Left,
    Right,
    Home,
    End,
    PageUp,
    PageDown,
    Delete,
    F(u8),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Chord {
    pub mods: Mods,
    pub key: Key,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Modifier {
    #[default]
    Ctrl,
    Alt,
    Meta,
}

impl Modifier {
    fn mods(self) -> Mods {
        Mods {
            ctrl: self == Modifier::Ctrl,
            alt: self == Modifier::Alt,
            meta: self == Modifier::Meta,
            shift: false,
        }
    }
}

impl Chord {
    /// Parses `Ctrl+H`, `Mod+Shift+1`, `Enter` or `H`. `Mod` stands for the
    /// configured main modifier. A lone uppercase letter means Shift+letter;
    /// with Ctrl or Alt the letter's case does not matter.
    pub fn parse(text: &str, modifier: Modifier) -> Option<Chord> {
        let parts: Vec<&str> = if text == "+" {
            vec!["+"]
        } else {
            text.split('+').collect()
        };
        let (key_part, mod_parts) = parts.split_last()?;
        let mut mods = Mods::default();
        for part in mod_parts {
            match part.to_lowercase().as_str() {
                "ctrl" | "control" => mods.ctrl = true,
                "alt" | "option" => mods.alt = true,
                "shift" => mods.shift = true,
                "meta" | "super" | "win" | "cmd" => mods.meta = true,
                "mod" => {
                    let m = modifier.mods();
                    mods.ctrl |= m.ctrl;
                    mods.alt |= m.alt;
                    mods.meta |= m.meta;
                }
                _ => return None,
            }
        }
        let key = match key_part.to_lowercase().as_str() {
            "enter" | "return" => Key::Enter,
            "tab" => Key::Tab,
            "backspace" => Key::Backspace,
            "esc" | "escape" => Key::Esc,
            "space" => Key::Space,
            "up" => Key::Up,
            "down" => Key::Down,
            "left" => Key::Left,
            "right" => Key::Right,
            "home" => Key::Home,
            "end" => Key::End,
            "pageup" => Key::PageUp,
            "pagedown" => Key::PageDown,
            "delete" | "del" => Key::Delete,
            "minus" => Key::Char('-'),
            "plus" => Key::Char('+'),
            f if f.len() > 1 && f.starts_with('f') => Key::F(f[1..].parse().ok()?),
            _ => {
                let mut chars = key_part.chars();
                let c = chars.next()?;
                if chars.next().is_some() {
                    return None;
                }
                if c.is_uppercase() && mod_parts.is_empty() {
                    mods.shift = true;
                }
                Key::Char(c.to_lowercase().next()?)
            }
        };
        Some(Chord { mods, key })
    }

    pub fn from_event(event: &KeyEvent) -> Option<Chord> {
        let m = event.modifiers;
        let mut mods = Mods {
            ctrl: m.contains(KeyModifiers::CONTROL),
            alt: m.contains(KeyModifiers::ALT),
            shift: m.contains(KeyModifiers::SHIFT),
            meta: m.intersects(KeyModifiers::SUPER | KeyModifiers::META),
        };
        let key = match event.code {
            KeyCode::Char(' ') => Key::Space,
            KeyCode::Char(c) => {
                if c.is_uppercase() {
                    mods.shift = true;
                } else if !c.is_alphabetic() {
                    // `?` already says Shift was held.
                    mods.shift = false;
                }
                Key::Char(c.to_lowercase().next()?)
            }
            KeyCode::Enter => Key::Enter,
            KeyCode::Tab => Key::Tab,
            KeyCode::BackTab => {
                mods.shift = true;
                Key::Tab
            }
            KeyCode::Backspace => Key::Backspace,
            KeyCode::Esc => Key::Esc,
            KeyCode::Up => Key::Up,
            KeyCode::Down => Key::Down,
            KeyCode::Left => Key::Left,
            KeyCode::Right => Key::Right,
            KeyCode::Home => Key::Home,
            KeyCode::End => Key::End,
            KeyCode::PageUp => Key::PageUp,
            KeyCode::PageDown => Key::PageDown,
            KeyCode::Delete => Key::Delete,
            KeyCode::F(n) => Key::F(n),
            _ => return None,
        };
        Some(Chord { mods, key })
    }

    /// The digit 1-9 of a chord, if it is one.
    pub fn digit(&self) -> Option<usize> {
        match self.key {
            Key::Char(c @ '1'..='9') => Some(c as usize - '0' as usize),
            _ => None,
        }
    }
}

impl fmt::Display for Chord {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let letter = matches!(self.key, Key::Char(c) if c.is_alphabetic());
        let bare = !self.mods.ctrl && !self.mods.alt && !self.mods.meta;
        for (on, name) in [
            (self.mods.ctrl, "Ctrl"),
            (self.mods.alt, "Alt"),
            (self.mods.meta, "Meta"),
            (self.mods.shift && !(bare && letter), "Shift"),
        ] {
            if on {
                write!(f, "{name}+")?;
            }
        }
        match self.key {
            Key::Char(c) if bare && self.mods.shift && letter => {
                write!(f, "{}", c.to_uppercase())
            }
            Key::Char(c) if letter && !bare => write!(f, "{}", c.to_uppercase()),
            Key::Char(c) => write!(f, "{c}"),
            Key::F(n) => write!(f, "F{n}"),
            other => write!(f, "{other:?}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chord(text: &str) -> Chord {
        Chord::parse(text, Modifier::Ctrl).unwrap()
    }

    fn event(code: KeyCode, modifiers: KeyModifiers) -> Chord {
        Chord::from_event(&KeyEvent::new(code, modifiers)).unwrap()
    }

    #[test]
    fn ctrl_letter_ignores_case() {
        assert_eq!(chord("Ctrl+H"), chord("ctrl+h"));
        assert_eq!(
            chord("Ctrl+H"),
            event(KeyCode::Char('h'), KeyModifiers::CONTROL)
        );
    }

    #[test]
    fn lone_uppercase_letter_means_shift() {
        assert_eq!(chord("H"), event(KeyCode::Char('H'), KeyModifiers::SHIFT));
        assert_ne!(chord("H"), chord("h"));
    }

    #[test]
    fn mod_resolves_to_the_configured_modifier() {
        assert_eq!(chord("Mod+1"), chord("Ctrl+1"));
        assert_eq!(
            Chord::parse("Mod+1", Modifier::Alt),
            Chord::parse("Alt+1", Modifier::Ctrl)
        );
    }

    #[test]
    fn punctuation_drops_the_implied_shift() {
        assert_eq!(chord("?"), event(KeyCode::Char('?'), KeyModifiers::SHIFT));
    }

    #[test]
    fn named_keys() {
        assert_eq!(chord("Enter").key, Key::Enter);
        assert_eq!(chord("Ctrl+Space").key, Key::Space);
        assert_eq!(chord("F12").key, Key::F(12));
        assert!(Chord::parse("Hyper+X", Modifier::Ctrl).is_none());
    }

    #[test]
    fn display_round_trips() {
        for text in ["Ctrl+H", "Ctrl+Shift+H", "H", "h", "Enter", "?", "Alt+1"] {
            assert_eq!(chord(text).to_string(), text);
        }
    }
}
