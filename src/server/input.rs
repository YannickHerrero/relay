use std::time::Instant;

use alacritty_terminal::grid::Scroll;
use crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind};

use super::Server;
use crate::encode;
use crate::keymap::{Entry, Node};
use crate::keys::{Chord, Key};
use crate::layout::Axis;

/// Keys typed after the leader, while its menu is open.
#[derive(Debug, Clone)]
pub struct Leader {
    pub path: Vec<Chord>,
    pub opened: Instant,
}

impl Leader {
    fn new() -> Leader {
        Leader {
            path: Vec::new(),
            opened: Instant::now(),
        }
    }
}

impl Server {
    pub(super) fn on_input(&mut self, event: Event) {
        match event {
            Event::Key(key) if key.kind != KeyEventKind::Release => self.on_key(key),
            Event::Paste(text) => {
                if let Some(window) = self.focused_window_mut() {
                    let bytes = encode::paste(&text, *window.pane.term.mode());
                    window.pane.write(bytes);
                }
            }
            Event::Mouse(mouse) => self.on_mouse(mouse),
            Event::Resize(cols, rows) => self.resize(cols, rows),
            _ => {}
        }
        self.dirty = true;
    }

    fn on_key(&mut self, key: KeyEvent) {
        if self.rename.is_some() {
            self.on_rename_key(key);
            return;
        }
        if self.menu.is_some() {
            self.on_menu_key(key);
            return;
        }
        if self.overlay.is_some() {
            self.on_overlay_key(key);
            return;
        }
        let chord = Chord::from_event(&key);
        if self.resize_mode {
            self.on_resize_key(key, chord);
            return;
        }
        if self.leader.is_some() {
            self.on_leader_key(key, chord);
            return;
        }
        if chord == Some(self.keymap.leader) {
            self.leader = Some(Leader::new());
            return;
        }
        if let Some(action) = chord.and_then(|c| self.keymap.direct.get(&c)).cloned() {
            self.execute(action);
            return;
        }
        self.forward_key(key);
    }

    fn on_leader_key(&mut self, key: KeyEvent, chord: Option<Chord>) {
        let Some(chord) = chord else {
            return;
        };
        let path = self
            .leader
            .as_ref()
            .map(|l| l.path.clone())
            .unwrap_or_default();
        match chord.key {
            Key::Esc if chord.mods == Default::default() => {
                self.leader = None;
                return;
            }
            Key::Backspace => {
                if let Some(leader) = &mut self.leader {
                    leader.path.clear();
                }
                return;
            }
            _ => {}
        }
        if chord == self.keymap.leader && path.is_empty() {
            self.leader = None;
            self.forward_key(key);
            return;
        }
        let Some(node) = node_at(&self.keymap.tree, &path) else {
            self.leader = None;
            return;
        };
        match node.get(&chord) {
            Some(Entry::Action(action)) => {
                let action = action.clone();
                if !action.repeatable() {
                    self.leader = None;
                }
                self.execute(action);
            }
            Some(Entry::Group(..)) => {
                if let Some(leader) = &mut self.leader {
                    leader.path.push(chord);
                }
            }
            // Unknown keys are swallowed and keep the menu open.
            None => {}
        }
    }

    /// j and ; shrink and grow the width, k and l grow and shrink the
    /// height, like i3's resize mode; arrows work too.
    fn on_resize_key(&mut self, key: KeyEvent, chord: Option<Chord>) {
        const STEP: f32 = 0.05;
        let step = match key.code {
            KeyCode::Char('j') | KeyCode::Left => Some((Axis::Vertical, -STEP)),
            KeyCode::Char(';') | KeyCode::Right => Some((Axis::Vertical, STEP)),
            KeyCode::Char('k') | KeyCode::Down => Some((Axis::Horizontal, STEP)),
            KeyCode::Char('l') | KeyCode::Up => Some((Axis::Horizontal, -STEP)),
            _ => None,
        };
        if let Some((axis, delta)) = step {
            self.resize_focused(axis, delta);
        } else if matches!(key.code, KeyCode::Esc | KeyCode::Enter)
            || chord == Some(self.keymap.leader)
        {
            self.resize_mode = false;
        }
    }

    fn forward_key(&mut self, key: KeyEvent) {
        if let Some(window) = self.focused_window_mut() {
            let bytes = encode::key(&key, *window.pane.term.mode());
            if !bytes.is_empty() {
                window.pane.term.scroll_display(Scroll::Bottom);
                window.pane.term.selection = None;
                window.pane.write(bytes);
            }
        }
    }

    fn focused_window_mut(&mut self) -> Option<&mut super::Window> {
        let id = self.model.focused()?;
        self.windows.get_mut(&id)
    }
}

pub fn node_at<'a>(tree: &'a Node, path: &[Chord]) -> Option<&'a Node> {
    let mut node = tree;
    for chord in path {
        match node.get(chord)? {
            Entry::Group(_, child) => node = child,
            Entry::Action(_) => return None,
        }
    }
    Some(node)
}
