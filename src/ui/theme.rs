//! Interface colors, taken from the client terminal's own palette so relay
//! follows its theme, light or dark.

use ratatui::style::Color;

/// Text drawn on a colored background (pills, hovered buttons).
pub const BASE: Color = Color::Indexed(0);
/// Background of inactive pills.
pub const SURFACE0: Color = Color::Indexed(8);
/// Text on `SURFACE0`.
pub const SURFACE_TEXT: Color = Color::Indexed(15);
/// Borders and separators.
pub const SURFACE1: Color = Color::Indexed(8);
/// Dim text: hints, details, inactive labels.
pub const OVERLAY0: Color = Color::Indexed(8);
pub const SUBTEXT0: Color = Color::Indexed(8);
pub const TEXT: Color = Color::Reset;
pub const ACCENT: Color = Color::Indexed(12);
pub const BLUE: Color = Color::Indexed(4);
pub const GREEN: Color = Color::Indexed(2);
pub const YELLOW: Color = Color::Indexed(3);
pub const TEAL: Color = Color::Indexed(6);
pub const PEACH: Color = Color::Indexed(1);
pub const RED: Color = Color::Indexed(1);
pub const MAUVE: Color = Color::Indexed(5);
