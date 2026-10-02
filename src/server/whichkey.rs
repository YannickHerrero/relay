//! The leader's help panel, bottom right, like Illium browser's.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use unicode_width::UnicodeWidthStr;

use super::Server;
use super::input::node_at;
use crate::keymap::{Entry, Node};
use crate::keys::Chord;
use crate::ui::{panel, theme};

struct Row {
    key: String,
    label: String,
    group: bool,
}

/// Rows for one menu level; runs of 1-9 that only differ by their number
/// fold into one `1…9` row.
fn rows(node: &Node) -> Vec<Row> {
    let mut rows: Vec<Row> = Vec::new();
    let mut digits: Vec<(usize, String)> = Vec::new();
    let flush = |rows: &mut Vec<Row>, digits: &mut Vec<(usize, String)>| {
        if digits.len() >= 3 {
            let (first, label) = &digits[0];
            let last = digits.last().unwrap().0;
            rows.push(Row {
                key: format!("{first}…{last}"),
                label: label.replace(&first.to_string(), "N"),
                group: false,
            });
        } else {
            for (n, label) in digits.iter() {
                rows.push(Row {
                    key: n.to_string(),
                    label: label.clone(),
                    group: false,
                });
            }
        }
        digits.clear();
    };
    for (chord, entry) in &node.entries {
        let (label, group) = match entry {
            Entry::Action(action) => (action.describe(), false),
            Entry::Group(label, _) => (label.clone(), true),
        };
        if let Some(n) = chord.digit().filter(|_| !group) {
            let same_shape = digits.last().is_none_or(|(m, l)| {
                *m + 1 == n && l.replace(&m.to_string(), "N") == label.replace(&n.to_string(), "N")
            });
            if !same_shape {
                flush(&mut rows, &mut digits);
            }
            digits.push((n, label));
            continue;
        }
        flush(&mut rows, &mut digits);
        rows.push(Row {
            key: chord.to_string(),
            label,
            group,
        });
    }
    flush(&mut rows, &mut digits);
    rows
}

impl Server {
    pub(super) fn draw_leader(&self, area: Rect, buf: &mut Buffer) {
        let Some(leader) = &self.leader else {
            return;
        };
        let Some(node) = node_at(&self.keymap.tree, &leader.path) else {
            return;
        };
        let rows = rows(node);
        let path: Vec<String> = std::iter::once(self.keymap.leader.to_string())
            .chain(leader.path.iter().map(Chord::to_string))
            .collect();
        let title = format!("{}  ·  {} keys", path.join(" › "), rows.len());

        let key_w = rows.iter().map(|r| r.key.width()).max().unwrap_or(1) as u16 + 2;
        let label_w = rows
            .iter()
            .map(|r| r.label.width() + 2 * r.group as usize)
            .max()
            .unwrap_or(1) as u16;
        let col_w = key_w + 2 + label_w + 2;
        let max_rows = area.height.saturating_sub(4).max(1);
        let columns = if leader.path.is_empty() && rows.len() as u16 > max_rows.min(14) {
            2
        } else {
            1
        };
        let per_col = (rows.len() as u16).div_ceil(columns);
        let width = (col_w * columns + 2)
            .max(title.width() as u16 + 4)
            .min(area.width);
        let height = (per_col + 2).min(area.height);
        let rect = Rect::new(
            area.x + area.width.saturating_sub(width + 1),
            area.y + area.height.saturating_sub(height + 1),
            width,
            height,
        );
        let inner = panel::draw(rect, &title, "esc close · ⌫ back", buf);
        for (i, row) in rows.iter().enumerate() {
            let (col, line) = (i as u16 / per_col, i as u16 % per_col);
            if line >= inner.height {
                continue;
            }
            let x = inner.x + col * col_w;
            let y = inner.y + line;
            if x >= inner.right() {
                continue;
            }
            let room = inner.right().saturating_sub(x) as usize;
            buf.set_stringn(x, y, format!(" {} ", row.key), room, panel::key_style());
            let lx = x + key_w + 1;
            if lx < inner.right() {
                let label = if row.group {
                    format!("{} ›", row.label)
                } else {
                    row.label.clone()
                };
                let style = if row.group {
                    Style::new().fg(theme::BLUE)
                } else {
                    Style::new().fg(theme::TEXT)
                };
                buf.set_stringn(
                    lx,
                    y,
                    label,
                    inner.right().saturating_sub(lx) as usize,
                    style,
                );
            }
        }
    }
}

impl Server {
    pub(super) fn draw_resize_hint(&self, area: Rect, buf: &mut Buffer) {
        let rows = [
            ("j  ;", "width −  +"),
            ("k  l", "height +  −"),
            ("esc", "done"),
        ];
        let width = 26.min(area.width);
        let height = (rows.len() as u16 + 2).min(area.height);
        let rect = Rect::new(
            area.x + area.width.saturating_sub(width + 1),
            area.y + area.height.saturating_sub(height + 1),
            width,
            height,
        );
        let inner = panel::draw(rect, "Resize", "", buf);
        for (i, (keys, label)) in rows.iter().enumerate() {
            let y = inner.y + i as u16;
            if y >= inner.bottom() {
                break;
            }
            buf.set_string(inner.x, y, format!(" {keys} "), panel::key_style());
            buf.set_stringn(
                inner.x + 8,
                y,
                label,
                inner.width.saturating_sub(8) as usize,
                Style::new().fg(theme::TEXT),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keymap::Keymap;
    use crate::keys::Modifier;

    #[test]
    fn digits_fold_into_one_row() {
        let leader = Chord::parse("Ctrl+B", Modifier::Ctrl).unwrap();
        let (keymap, _) = Keymap::build(&Default::default(), Modifier::Ctrl, leader);
        let rows = rows(&keymap.tree);
        let folded = rows.iter().find(|r| r.key == "1…9").expect("folded row");
        assert_eq!(folded.label, "Workspace N");
        assert!(rows.iter().any(|r| r.key == "m" && r.group));
        assert!(rows.len() < 30);
    }
}
