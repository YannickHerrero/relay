//! Right-click context menus.

use std::time::Instant;

use crossterm::event::{KeyCode, KeyEvent, MouseButton, MouseEvent, MouseEventKind};
use ratatui::buffer::Buffer;
use ratatui::layout::{Position, Rect};
use ratatui::style::{Modifier, Style};
use unicode_width::UnicodeWidthStr;

use super::Server;
use super::bar::BarItem;
use crate::actions::Action;
use crate::model::{WORKSPACES, WindowId};
use crate::ui::{panel, theme};

#[derive(Debug, Clone)]
pub struct Menu {
    pub x: u16,
    pub y: u16,
    pub items: Vec<(String, Action)>,
    pub selected: usize,
    pub opened: Instant,
}

impl Menu {
    fn rect(&self, screen: Rect) -> Rect {
        let width = self.items.iter().map(|(l, _)| l.width()).max().unwrap_or(4) as u16 + 4;
        let height = self.items.len() as u16 + 2;
        let x = self.x.min(screen.right().saturating_sub(width));
        let y = self.y.min(screen.bottom().saturating_sub(height));
        Rect::new(x, y, width.min(screen.width), height.min(screen.height))
    }
}

impl Server {
    pub(super) fn window_menu(&mut self, id: WindowId, x: u16, y: u16) {
        self.focus(id);
        let current = self.model.space().active;
        let mut items = vec![
            ("New terminal".to_owned(), Action::Spawn("terminal".into())),
            ("Fullscreen".to_owned(), Action::WindowFullscreen),
            ("Float / tile".to_owned(), Action::WindowToggleFloat),
            ("Rename".to_owned(), Action::WindowRename),
        ];
        for n in (0..WORKSPACES).filter(|n| *n != current) {
            items.push((
                format!("Move to workspace {}", n + 1),
                Action::WindowMoveWorkspace {
                    workspace: n + 1,
                    follow: false,
                },
            ));
        }
        items.push(("Close".to_owned(), Action::WindowClose));
        self.menu = Some(Menu {
            x,
            y,
            items,
            selected: 0,
            opened: Instant::now(),
        });
    }

    pub(super) fn bar_menu(&mut self, item: BarItem, x: u16) {
        let items = match item {
            BarItem::Workspace(n) => {
                let mut items = vec![
                    (
                        format!("Go to workspace {}", n + 1),
                        Action::Workspace(n + 1),
                    ),
                    ("Rename".to_owned(), Action::WorkspaceRename(Some(n))),
                ];
                if self.model.focused().is_some() {
                    items.push((
                        "Move focused window here".to_owned(),
                        Action::WindowMoveWorkspace {
                            workspace: n + 1,
                            follow: true,
                        },
                    ));
                }
                items
            }
            BarItem::Space => vec![
                ("Spaces…".to_owned(), Action::SpacePicker),
                ("Next space".to_owned(), Action::SpaceNext),
            ],
        };
        self.menu = Some(Menu {
            x,
            y: 1,
            items,
            selected: 0,
            opened: Instant::now(),
        });
    }

    pub(super) fn on_menu_key(&mut self, key: KeyEvent) {
        let Some(menu) = &mut self.menu else {
            return;
        };
        match key.code {
            KeyCode::Esc => self.menu = None,
            KeyCode::Up | KeyCode::Char('k') => menu.selected = menu.selected.saturating_sub(1),
            KeyCode::Down | KeyCode::Char('j') => {
                menu.selected = (menu.selected + 1).min(menu.items.len() - 1);
            }
            KeyCode::Enter => {
                let action = menu.items[menu.selected].1.clone();
                self.menu = None;
                self.execute(action);
            }
            _ => {}
        }
        self.dirty = true;
    }

    pub(super) fn on_menu_mouse(&mut self, event: MouseEvent) {
        let screen = self.screen();
        let Some(menu) = &mut self.menu else {
            return;
        };
        let rect = menu.rect(screen);
        let point = Position::new(event.column, event.row);
        let item = (rect.contains(point) && event.row > rect.y && event.row < rect.bottom() - 1)
            .then(|| (event.row - rect.y - 1) as usize);
        match event.kind {
            MouseEventKind::Moved => {
                if let Some(i) = item {
                    menu.selected = i;
                }
            }
            MouseEventKind::Down(MouseButton::Left) | MouseEventKind::Up(MouseButton::Right) => {
                if let Some(i) = item {
                    let action = menu.items[i].1.clone();
                    self.menu = None;
                    self.execute(action);
                } else if !rect.contains(point) && matches!(event.kind, MouseEventKind::Down(_)) {
                    self.menu = None;
                }
            }
            MouseEventKind::Down(_) if !rect.contains(point) => self.menu = None,
            _ => {}
        }
        self.dirty = true;
    }

    pub(super) fn draw_menu(&self, buf: &mut Buffer) {
        let Some(menu) = &self.menu else {
            return;
        };
        let rect = menu.rect(self.screen());
        let inner = panel::draw(rect, "", "", buf);
        for (i, (label, _)) in menu.items.iter().enumerate() {
            let y = inner.y + i as u16;
            if y >= inner.bottom() {
                break;
            }
            let style = if i == menu.selected {
                Style::new().fg(theme::ACCENT).add_modifier(Modifier::BOLD)
            } else {
                Style::new().fg(theme::TEXT)
            };
            for x in inner.x..inner.right() {
                buf[(x, y)].set_style(style);
            }
            buf.set_stringn(
                inner.x + 1,
                y,
                label,
                inner.width.saturating_sub(1) as usize,
                style,
            );
        }
    }
}
