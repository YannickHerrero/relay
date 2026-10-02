//! Catppuccin Mocha, Illium's default dark theme.

use ratatui::style::Color;

pub const BASE: Color = Color::Rgb(0x1e, 0x1e, 0x2e);
pub const SURFACE0: Color = Color::Rgb(0x31, 0x32, 0x44);
pub const SURFACE1: Color = Color::Rgb(0x45, 0x47, 0x5a);
pub const OVERLAY0: Color = Color::Rgb(0x6c, 0x70, 0x86);
pub const SUBTEXT0: Color = Color::Rgb(0xa6, 0xad, 0xc8);
pub const TEXT: Color = Color::Rgb(0xcd, 0xd6, 0xf4);
pub const ACCENT: Color = Color::Rgb(0xb4, 0xbe, 0xfe);
pub const BLUE: Color = Color::Rgb(0x89, 0xb4, 0xfa);
pub const GREEN: Color = Color::Rgb(0xa6, 0xe3, 0xa1);
pub const YELLOW: Color = Color::Rgb(0xf9, 0xe2, 0xaf);
pub const PEACH: Color = Color::Rgb(0xfa, 0xb3, 0x87);
pub const RED: Color = Color::Rgb(0xf3, 0x8b, 0xa8);
pub const MAUVE: Color = Color::Rgb(0xcb, 0xa6, 0xf7);

/// Mixes `from` toward `to` by `t` in 0..=1. Non-RGB colors snap at the end.
pub fn blend(from: Color, to: Color, t: f32) -> Color {
    match (from, to) {
        (Color::Rgb(r1, g1, b1), Color::Rgb(r2, g2, b2)) => {
            let mix =
                |a: u8, b: u8| (a as f32 + (b as f32 - a as f32) * t.clamp(0.0, 1.0)).round() as u8;
            Color::Rgb(mix(r1, r2), mix(g1, g2), mix(b1, b2))
        }
        _ if t >= 1.0 => to,
        _ => from,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blend_interpolates_rgb() {
        assert_eq!(
            blend(Color::Rgb(0, 0, 0), Color::Rgb(200, 100, 0), 0.5),
            Color::Rgb(100, 50, 0)
        );
        assert_eq!(blend(BASE, TEXT, 1.0), TEXT);
        assert_eq!(blend(Color::Reset, TEXT, 0.4), Color::Reset);
    }
}
