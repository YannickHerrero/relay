//! Direct chords and leader sequences, from the defaults and
//! `keybindings.toml`.

use std::collections::{BTreeMap, HashMap};

use crate::actions::Action;
use crate::keys::{Chord, Modifier};

/// `Mod` is the configured modifier; `Leader` starts a leader sequence.
pub const DEFAULTS: &[(&str, &str)] = &[
    ("Mod+H", "window focus left"),
    ("Mod+J", "window focus down"),
    ("Mod+K", "window focus up"),
    ("Mod+L", "window focus right"),
    ("Mod+Shift+H", "window move left"),
    ("Mod+Shift+J", "window move down"),
    ("Mod+Shift+K", "window move up"),
    ("Mod+Shift+L", "window move right"),
    ("Mod+1", "workspace 1"),
    ("Mod+2", "workspace 2"),
    ("Mod+3", "workspace 3"),
    ("Mod+4", "workspace 4"),
    ("Mod+5", "workspace 5"),
    ("Mod+6", "workspace 6"),
    ("Mod+7", "workspace 7"),
    ("Mod+8", "workspace 8"),
    ("Mod+9", "workspace 9"),
    ("Mod+Space", "palette toggle"),
    ("Mod+Q", "window close"),
    ("Leader Enter", "spawn terminal"),
    ("Leader Space", "palette toggle"),
    ("Leader q", "window close"),
    ("Leader f", "window toggle-fullscreen"),
    ("Leader t", "window toggle-float"),
    ("Leader h", "window focus left"),
    ("Leader j", "window focus down"),
    ("Leader k", "window focus up"),
    ("Leader l", "window focus right"),
    ("Leader r", "window resize-mode"),
    ("Leader H", "window move left"),
    ("Leader J", "window move down"),
    ("Leader K", "window move up"),
    ("Leader L", "window move right"),
    ("Leader s", "workspace next-active"),
    ("Leader Tab", "workspace recent"),
    ("Leader 1", "workspace 1"),
    ("Leader 2", "workspace 2"),
    ("Leader 3", "workspace 3"),
    ("Leader 4", "workspace 4"),
    ("Leader 5", "workspace 5"),
    ("Leader 6", "workspace 6"),
    ("Leader 7", "workspace 7"),
    ("Leader 8", "workspace 8"),
    ("Leader 9", "workspace 9"),
    ("Leader m 1", "window move-workspace 1 --follow"),
    ("Leader m 2", "window move-workspace 2 --follow"),
    ("Leader m 3", "window move-workspace 3 --follow"),
    ("Leader m 4", "window move-workspace 4 --follow"),
    ("Leader m 5", "window move-workspace 5 --follow"),
    ("Leader m 6", "window move-workspace 6 --follow"),
    ("Leader m 7", "window move-workspace 7 --follow"),
    ("Leader m 8", "window move-workspace 8 --follow"),
    ("Leader m 9", "window move-workspace 9 --follow"),
    ("Leader o", "space picker"),
    ("Leader Shift+Tab", "space recent"),
    ("Leader n", "workspace next"),
    ("Leader p", "workspace prev"),
    ("Leader ?", "keybindings toggle"),
    ("Leader x d", "client detach"),
    ("Leader x r", "config reload"),
    ("Leader x q", "server stop"),
];

const GROUP_LABELS: &[(&str, &str)] = &[("m", "Move to workspace"), ("x", "System")];

#[derive(Debug, Default)]
pub struct Node {
    pub entries: Vec<(Chord, Entry)>,
}

#[derive(Debug)]
pub enum Entry {
    Action(Action),
    Group(String, Node),
}

impl Node {
    pub fn get(&self, chord: &Chord) -> Option<&Entry> {
        self.entries
            .iter()
            .find(|(c, _)| c == chord)
            .map(|(_, e)| e)
    }

    fn insert(&mut self, path: &[Chord], label: &str, action: Action) {
        let (first, rest) = path.split_first().expect("non-empty path");
        let existing = self.entries.iter().position(|(c, _)| c == first);
        if rest.is_empty() {
            match existing {
                Some(i) => self.entries[i].1 = Entry::Action(action),
                None => self.entries.push((*first, Entry::Action(action))),
            }
            return;
        }
        let i = match existing {
            Some(i) if matches!(self.entries[i].1, Entry::Group(..)) => i,
            Some(i) => {
                self.entries[i].1 = Entry::Group(label.to_owned(), Node::default());
                i
            }
            None => {
                self.entries
                    .push((*first, Entry::Group(label.to_owned(), Node::default())));
                self.entries.len() - 1
            }
        };
        if let Entry::Group(_, node) = &mut self.entries[i].1 {
            node.insert(rest, label, action);
        }
    }

    fn remove(&mut self, path: &[Chord]) {
        let Some((first, rest)) = path.split_first() else {
            return;
        };
        if rest.is_empty() {
            self.entries.retain(|(c, _)| c != first);
        } else if let Some((_, Entry::Group(_, node))) =
            self.entries.iter_mut().find(|(c, _)| c == first)
        {
            node.remove(rest);
        }
    }
}

pub struct Keymap {
    pub leader: Chord,
    pub direct: HashMap<Chord, Action>,
    pub tree: Node,
    /// Every binding in display order, for the keybindings viewer.
    pub listing: Vec<(String, Action)>,
}

#[derive(serde::Deserialize, Default)]
pub struct KeybindingsFile {
    #[serde(default)]
    pub keybindings: BTreeMap<String, String>,
}

impl Keymap {
    /// Defaults overridden by `user`. An empty command unbinds a key.
    /// Returns the keymap and the entries that could not be parsed.
    pub fn build(
        user: &BTreeMap<String, String>,
        modifier: Modifier,
        leader: Chord,
    ) -> (Keymap, Vec<String>) {
        let mut errors = Vec::new();
        let mut bindings: Vec<(String, String)> = DEFAULTS
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        for (key, command) in user {
            match bindings.iter_mut().find(|(k, _)| k == key) {
                Some(entry) => entry.1 = command.clone(),
                None => bindings.push((key.clone(), command.clone())),
            }
        }
        let mut keymap = Keymap {
            leader,
            direct: HashMap::new(),
            tree: Node::default(),
            listing: Vec::new(),
        };
        for (keys, command) in &bindings {
            let Some(steps) = parse_sequence(keys, modifier) else {
                errors.push(format!("unknown key: {keys}"));
                continue;
            };
            if command.trim().is_empty() {
                match &steps {
                    Sequence::Direct(chord) => {
                        keymap.direct.remove(chord);
                    }
                    Sequence::Leader(path) => keymap.tree.remove(path),
                }
                continue;
            }
            let Some(action) = Action::parse(command) else {
                errors.push(format!("unknown command for {keys}: {command}"));
                continue;
            };
            let shown = match &steps {
                Sequence::Direct(chord) => chord.to_string(),
                Sequence::Leader(path) => std::iter::once(leader.to_string())
                    .chain(path.iter().map(Chord::to_string))
                    .collect::<Vec<_>>()
                    .join(" "),
            };
            keymap.listing.push((shown, action.clone()));
            match steps {
                Sequence::Direct(chord) => {
                    keymap.direct.insert(chord, action);
                }
                Sequence::Leader(path) => {
                    let first = keys.split_whitespace().nth(1).unwrap_or_default();
                    let label = GROUP_LABELS
                        .iter()
                        .find(|(k, _)| *k == first)
                        .map(|(_, l)| (*l).to_owned())
                        .unwrap_or_else(|| format!("+{first}"));
                    keymap.tree.insert(&path, &label, action);
                }
            }
        }
        (keymap, errors)
    }
}

enum Sequence {
    Direct(Chord),
    Leader(Vec<Chord>),
}

fn parse_sequence(text: &str, modifier: Modifier) -> Option<Sequence> {
    let mut words = text.split_whitespace();
    let first = words.next()?;
    if first.eq_ignore_ascii_case("leader") {
        let path = words
            .map(|w| Chord::parse(w, modifier))
            .collect::<Option<Vec<_>>>()?;
        if path.is_empty() {
            return None;
        }
        return Some(Sequence::Leader(path));
    }
    if words.next().is_some() {
        return None;
    }
    Chord::parse(first, modifier).map(Sequence::Direct)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::Direction;

    fn chord(text: &str) -> Chord {
        Chord::parse(text, Modifier::Ctrl).unwrap()
    }

    fn defaults() -> Keymap {
        let (keymap, errors) = Keymap::build(&BTreeMap::new(), Modifier::Ctrl, chord("Ctrl+B"));
        assert!(errors.is_empty(), "{errors:?}");
        keymap
    }

    #[test]
    fn defaults_all_parse() {
        let keymap = defaults();
        assert_eq!(
            keymap.direct.get(&chord("Ctrl+H")),
            Some(&Action::WindowFocus(Direction::Left))
        );
    }

    #[test]
    fn shift_distinguishes_swap_from_focus() {
        let keymap = defaults();
        assert_eq!(
            keymap.direct.get(&chord("Ctrl+Shift+H")),
            Some(&Action::WindowMove(Direction::Left))
        );
    }

    #[test]
    fn leader_groups_nest() {
        let keymap = defaults();
        let Some(Entry::Group(label, node)) = keymap.tree.get(&chord("m")) else {
            panic!("m is a group");
        };
        assert_eq!(label, "Move to workspace");
        assert!(matches!(
            node.get(&chord("3")),
            Some(Entry::Action(Action::WindowMoveWorkspace {
                workspace: 3,
                ..
            }))
        ));
    }

    #[test]
    fn user_entries_override_and_unbind() {
        let user = BTreeMap::from([
            ("Mod+Space".to_owned(), String::new()),
            ("Leader g".to_owned(), "popup lazygit".to_owned()),
            ("Leader q".to_owned(), "server stop".to_owned()),
        ]);
        let (keymap, errors) = Keymap::build(&user, Modifier::Alt, chord("Ctrl+B"));
        assert!(errors.is_empty());
        assert!(!keymap.direct.contains_key(&chord("Alt+Space")));
        assert!(keymap.direct.contains_key(&chord("Alt+H")));
        assert!(matches!(
            keymap.tree.get(&chord("g")),
            Some(Entry::Action(Action::Popup(_)))
        ));
        assert!(matches!(
            keymap.tree.get(&chord("q")),
            Some(Entry::Action(Action::ServerStop))
        ));
    }

    #[test]
    fn bad_entries_are_reported() {
        let user = BTreeMap::from([("Leader z".to_owned(), "fly away".to_owned())]);
        let (_, errors) = Keymap::build(&user, Modifier::Ctrl, chord("Ctrl+B"));
        assert_eq!(errors.len(), 1);
    }
}
