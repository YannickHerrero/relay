//! Modal lists drawn over the windows, such as the palette.

use std::path::PathBuf;
use std::time::Instant;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::buffer::Buffer;
use ratatui::layout::{Position, Rect};
use ratatui::style::{Modifier, Style};
use unicode_width::UnicodeWidthStr;

use super::Server;
use super::bar::status_style;
use super::spaces::Prompt;
use crate::actions::Action;
use crate::detect::tracker::Status;
use crate::keys::Chord;
use crate::model::WindowId;
use crate::ui::{fuzzy, panel, theme};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListKind {
    Palette,
    Keys,
    Spaces,
    Agents,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Target {
    Action(Action),
    Window(WindowId),
    Space(usize),
    Project(PathBuf),
    Program(String),
}

#[derive(Debug, Clone)]
pub struct Row {
    pub label: String,
    pub detail: String,
    pub status: Option<Status>,
    pub tag: &'static str,
    pub target: Option<Target>,
}

#[derive(Debug, Clone)]
pub struct ListOverlay {
    pub kind: ListKind,
    pub query: String,
    pub selected: usize,
    pub scroll: usize,
    pub opened: Instant,
    pub prompt: Option<Prompt>,
    /// `D` was pressed once in the space picker; a second `D` deletes.
    pub confirm_delete: bool,
}

impl ListOverlay {
    pub fn new(kind: ListKind) -> ListOverlay {
        ListOverlay {
            kind,
            query: String::new(),
            selected: 0,
            scroll: 0,
            opened: Instant::now(),
            prompt: None,
            confirm_delete: false,
        }
    }
}

/// What a key or click did to an open list.
pub enum Outcome {
    Keep,
    Close,
    Run(Target),
}

/// `@w`, `@b`, `@d`, `@i`, or `@a` (blocked or done) narrow to windows in
/// that agent state.
fn state_filter(query: &str) -> (Option<Vec<Status>>, &str) {
    let Some(rest) = query.strip_prefix('@') else {
        return (None, query);
    };
    let (token, rest) = rest.split_once(' ').unwrap_or((rest, ""));
    let states = match token.chars().next() {
        None => vec![Status::Working, Status::Blocked, Status::Done, Status::Idle],
        Some('a') => vec![Status::Blocked, Status::Done],
        Some('w') => vec![Status::Working],
        Some('b' | 'n') => vec![Status::Blocked],
        Some('d') => vec![Status::Done],
        Some('i') => vec![Status::Idle],
        Some(_) => vec![],
    };
    (Some(states), rest.trim_start())
}

pub fn filter(rows: Vec<Row>, query: &str) -> Vec<Row> {
    let (states, text) = state_filter(query);
    let mut scored: Vec<(i32, usize, Row)> = rows
        .into_iter()
        .enumerate()
        .filter(|(_, row)| match &states {
            Some(states) => row.status.is_some_and(|s| states.contains(&s)),
            None => true,
        })
        .filter_map(|(i, row)| {
            let score = fuzzy::score(text, &row.label)
                .or_else(|| fuzzy::score(text, &row.detail).map(|s| s / 2 - 20))?;
            Some((score, i, row))
        })
        .collect();
    if !text.is_empty() {
        scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    }
    scored.into_iter().map(|(_, _, row)| row).collect()
}

/// Panel and list area of a list overlay with `count` rows.
fn geometry(area: Rect, count: usize) -> (Rect, Rect) {
    let width = area.width.saturating_sub(4).min(96);
    let max_rows = area.height.saturating_sub(8).max(1);
    let rows = (count as u16).clamp(1, max_rows);
    let height = rows + 4;
    let panel = Rect::new(
        area.x + (area.width - width) / 2,
        area.y + area.height.saturating_sub(height) / 4 + 1,
        width,
        height,
    );
    let list = Rect::new(
        panel.x + 1,
        panel.y + 3,
        panel.width.saturating_sub(2),
        rows,
    );
    (panel, list)
}

pub fn scroll_for(selected: usize, scroll: usize, visible: usize) -> usize {
    if visible == 0 {
        0
    } else if selected < scroll {
        selected
    } else if selected >= scroll + visible {
        selected + 1 - visible
    } else {
        scroll
    }
}

impl Server {
    /// Opens a list, or closes it when it is already open.
    pub(super) fn open_list(&mut self, kind: ListKind) {
        let same = self.overlay.as_ref().is_some_and(|o| o.kind == kind);
        self.overlay = if same {
            None
        } else {
            let mut overlay = ListOverlay::new(kind);
            // Enter goes back and forth between the last two spaces.
            if kind == ListKind::Spaces {
                overlay.selected = self.model.recent;
            }
            Some(overlay)
        };
        self.leader = None;
        self.dirty = true;
    }

    pub(super) fn list_rows(&self, overlay: &ListOverlay) -> Vec<Row> {
        let rows = match overlay.kind {
            ListKind::Palette => self.palette_rows(),
            ListKind::Keys => self.key_rows(),
            ListKind::Spaces => self.space_rows(),
            ListKind::Agents => self.agent_rows(),
        };
        filter(rows, &overlay.query)
    }

    pub(super) fn on_overlay_key(&mut self, key: KeyEvent) {
        let Some(mut overlay) = self.overlay.take() else {
            return;
        };
        let outcome = self.list_key(&mut overlay, key);
        self.finish_list(overlay, outcome);
    }

    pub(super) fn on_overlay_mouse(&mut self, event: MouseEvent) {
        let Some(mut overlay) = self.overlay.take() else {
            return;
        };
        let rows = self.list_rows(&overlay);
        let (panel, list) = geometry(self.screen(), rows.len());
        let point = Position::new(event.column, event.row);
        let last = rows.len().saturating_sub(1);
        let outcome = match event.kind {
            MouseEventKind::ScrollUp => {
                overlay.selected = overlay.selected.saturating_sub(1);
                Outcome::Keep
            }
            MouseEventKind::ScrollDown => {
                overlay.selected = (overlay.selected + 1).min(last);
                Outcome::Keep
            }
            MouseEventKind::Down(MouseButton::Left) if list.contains(point) => {
                let index = overlay.scroll + (event.row - list.y) as usize;
                match rows.get(index).and_then(|r| r.target.clone()) {
                    Some(target) => Outcome::Run(target),
                    None => Outcome::Keep,
                }
            }
            MouseEventKind::Down(_) if !panel.contains(point) => Outcome::Close,
            _ => Outcome::Keep,
        };
        self.finish_list(overlay, outcome);
    }

    fn finish_list(&mut self, mut overlay: ListOverlay, outcome: Outcome) {
        match outcome {
            Outcome::Keep => {
                let count = self.list_rows(&overlay).len();
                overlay.selected = overlay.selected.min(count.saturating_sub(1));
                let (_, list) = geometry(self.screen(), count);
                overlay.scroll = scroll_for(overlay.selected, overlay.scroll, list.height as usize);
                // Running a row may have opened another list meanwhile.
                if self.overlay.is_none() {
                    self.overlay = Some(overlay);
                }
            }
            Outcome::Close => {}
            Outcome::Run(target) => self.run_target(target),
        }
        self.dirty = true;
    }

    fn list_key(&mut self, overlay: &mut ListOverlay, key: KeyEvent) -> Outcome {
        if overlay.kind == ListKind::Spaces {
            return self.spaces_key(overlay, key);
        }
        if overlay.kind == ListKind::Agents {
            return self.agents_key(overlay, key);
        }
        let toggles = Chord::from_event(&key)
            .and_then(|c| self.keymap.direct.get(&c))
            .is_some_and(|a| *a == Action::Palette);
        if toggles {
            return Outcome::Close;
        }
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        match key.code {
            KeyCode::Esc if !overlay.query.is_empty() => overlay.query.clear(),
            KeyCode::Esc => return Outcome::Close,
            KeyCode::Enter => {
                let rows = self.list_rows(overlay);
                return match rows.get(overlay.selected).and_then(|r| r.target.clone()) {
                    Some(target) => Outcome::Run(target),
                    None => Outcome::Keep,
                };
            }
            KeyCode::Up | KeyCode::BackTab => overlay.selected = overlay.selected.saturating_sub(1),
            KeyCode::Down | KeyCode::Tab => overlay.selected += 1,
            KeyCode::Char('k') if ctrl => overlay.selected = overlay.selected.saturating_sub(1),
            KeyCode::Char('n' | 'j') if ctrl => overlay.selected += 1,
            KeyCode::PageUp => overlay.selected = overlay.selected.saturating_sub(10),
            KeyCode::PageDown => overlay.selected += 10,
            KeyCode::Char('u') if ctrl => overlay.query.clear(),
            KeyCode::Char('w') if ctrl => {
                let trimmed = overlay.query.trim_end().len();
                let cut = overlay.query[..trimmed]
                    .rfind(' ')
                    .map(|i| i + 1)
                    .unwrap_or(0);
                overlay.query.truncate(cut);
            }
            KeyCode::Backspace => {
                overlay.query.pop();
                overlay.selected = 0;
            }
            KeyCode::Char(c) if !ctrl => {
                overlay.query.push(c);
                overlay.selected = 0;
            }
            _ => {}
        }
        Outcome::Keep
    }

    pub(super) fn run_target(&mut self, target: Target) {
        match target {
            Target::Action(action) => self.execute(action),
            Target::Window(id) => self.focus(id),
            Target::Space(index) => self.switch_space(index),
            Target::Project(path) => {
                self.open_space(&path, None);
            }
            Target::Program(command) => {
                let cwd = self.new_window_cwd();
                self.spawn_shell(cwd, Some(&command));
            }
        }
    }

    pub(super) fn draw_overlay(&self, area: Rect, buf: &mut Buffer) {
        let Some(overlay) = &self.overlay else {
            return;
        };
        let rows = self.list_rows(overlay);
        let (panel_rect, list) = geometry(area, rows.len());
        let (title, footer) = match overlay.kind {
            ListKind::Palette => ("Palette", "⏎ run · @w @b @d filter · esc close"),
            ListKind::Keys => ("Keybindings", "type to filter · ⏎ run · esc close"),
            ListKind::Spaces => (
                "Spaces",
                "⏎ switch · N new · E rename · D D delete · esc close",
            ),
            ListKind::Agents => ("Agents", "j k select · ⏎ focus · tab scope · esc close"),
        };
        let inner = panel::draw(panel_rect, title, footer, buf);
        match (&overlay.prompt, overlay.kind) {
            (Some(prompt), _) => self.draw_input(inner, prompt.title(), &prompt.text, buf),
            (None, ListKind::Agents) => {
                let scope = if self.agents_current_space {
                    format!("space {}", self.model.space().name)
                } else {
                    "all spaces".to_owned()
                };
                self.draw_input(inner, "scope ›", &scope, buf);
            }
            (None, _) => self.draw_input(inner, "❯", &overlay.query, buf),
        }
        if overlay.confirm_delete {
            let warn = "press D again to delete";
            let x = inner.right().saturating_sub(warn.width() as u16 + 1);
            buf.set_string(x, inner.y, warn, Style::new().fg(theme::PEACH));
        }

        let visible = list.height as usize;
        for (i, row) in rows.iter().skip(overlay.scroll).take(visible).enumerate() {
            let y = list.y + i as u16;
            draw_row(row, list, y, overlay.scroll + i == overlay.selected, buf);
        }
        if rows.is_empty() {
            buf.set_string(
                list.x + 2,
                list.y,
                "no match",
                Style::new().fg(theme::OVERLAY0),
            );
        }
    }

    /// The input line and the rule under it.
    pub(super) fn draw_input(&self, inner: Rect, label: &str, text: &str, buf: &mut Buffer) {
        let style = Style::new().fg(theme::ACCENT).add_modifier(Modifier::BOLD);
        buf.set_string(inner.x + 1, inner.y, label, style);
        let tx = inner.x + 2 + label.width() as u16;
        let room = inner.right().saturating_sub(tx + 1) as usize;
        buf.set_stringn(tx, inner.y, text, room, Style::new().fg(theme::TEXT));
        let cx = (tx + text.width() as u16).min(inner.right().saturating_sub(1));
        buf.set_string(cx, inner.y, "▏", Style::new().fg(theme::ACCENT));
        for x in inner.x..inner.right() {
            buf[(x, inner.y + 1)]
                .set_symbol("─")
                .set_fg(theme::SURFACE1);
        }
    }

    pub(super) fn screen(&self) -> Rect {
        Rect::new(0, 0, self.size.0, self.size.1)
    }
}

fn draw_row(row: &Row, list: Rect, y: u16, selected: bool, buf: &mut Buffer) {
    let base = Style::new();
    for x in list.x..list.right() {
        buf[(x, y)].set_style(base);
    }
    if selected {
        buf.set_string(list.x, y, "▌", base.fg(theme::ACCENT));
    }
    let tag_w = row.tag.width() as u16;
    let right = list.right().saturating_sub(tag_w + 2);
    let mut x = list.x + 2;
    buf.set_stringn(
        x,
        y,
        &row.label,
        right.saturating_sub(x) as usize,
        if selected {
            Style::new().fg(theme::ACCENT).add_modifier(Modifier::BOLD)
        } else {
            base.fg(theme::TEXT)
        },
    );
    x += row.label.width() as u16 + 2;
    if let Some(status) = row.status.filter(|s| *s != Status::Unknown)
        && x < right
    {
        let (label, style) = status_style(status);
        let badge = format!("● {label}");
        buf.set_stringn(
            x,
            y,
            &badge,
            right.saturating_sub(x) as usize,
            style.patch(base),
        );
        x += badge.width() as u16 + 2;
    }
    if !row.detail.is_empty() && x < right {
        let room = right.saturating_sub(x) as usize;
        let detail = if row.detail.width() > room {
            format!("…{}", tail(&row.detail, room.saturating_sub(1)))
        } else {
            row.detail.clone()
        };
        let dx = right.saturating_sub(detail.width() as u16).max(x);
        buf.set_string(dx, y, detail, base.fg(theme::SUBTEXT0));
    }
    buf.set_string(
        list.right().saturating_sub(tag_w + 1),
        y,
        row.tag,
        base.fg(theme::OVERLAY0),
    );
}

/// The last characters of `text` that fit in `width` columns.
fn tail(text: &str, width: usize) -> String {
    let mut out = String::new();
    for c in text.chars().rev() {
        if out.width() + 1 > width {
            break;
        }
        out.insert(0, c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(label: &str, status: Option<Status>) -> Row {
        Row {
            label: label.into(),
            detail: String::new(),
            status,
            tag: "",
            target: None,
        }
    }

    #[test]
    fn state_filter_keeps_matching_windows() {
        let rows = vec![
            row("claude", Some(Status::Blocked)),
            row("pi", Some(Status::Working)),
            row("New terminal", None),
        ];
        let filtered = filter(rows, "@b");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].label, "claude");
    }

    #[test]
    fn text_query_ranks_best_first() {
        let rows = vec![row("Fullscreen tile", None), row("New terminal", None)];
        assert_eq!(filter(rows, "nt")[0].label, "New terminal");
    }

    #[test]
    fn scroll_follows_selection() {
        assert_eq!(scroll_for(12, 0, 10), 3);
        assert_eq!(scroll_for(2, 5, 10), 2);
        assert_eq!(scroll_for(6, 5, 10), 5);
    }

    #[test]
    fn tail_keeps_the_end() {
        assert_eq!(tail("~/dev/relay", 5), "relay");
    }
}
