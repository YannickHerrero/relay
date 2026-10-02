//! The space picker: switch, create (N), rename (E) and delete (D D).

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use super::Server;
use super::bar::rollup;
use super::overlay::{ListOverlay, Outcome, Row, Target};
use crate::config::tilde;

/// A name typed in the picker for a new or renamed space.
#[derive(Debug, Clone)]
pub struct Prompt {
    pub text: String,
    pub rename: Option<usize>,
}

impl Prompt {
    pub fn title(&self) -> &'static str {
        if self.rename.is_some() {
            "rename ›"
        } else {
            "new space ›"
        }
    }
}

pub fn valid_name(name: &str) -> bool {
    (1..=24).contains(&name.chars().count())
        && !name
            .chars()
            .any(|c| c.is_whitespace() || c == '"' || c == '\'')
}

impl Server {
    pub(super) fn space_rows(&self) -> Vec<Row> {
        self.model
            .spaces
            .iter()
            .enumerate()
            .map(|(i, space)| {
                let windows: Vec<_> = space.windows().collect();
                let status = rollup(
                    windows
                        .iter()
                        .filter_map(|id| self.windows.get(id)?.tracker.status()),
                );
                let current = if i == self.model.active { " ●" } else { "" };
                Row {
                    label: format!("{}{current}", space.name),
                    detail: format!("{} windows · {}", windows.len(), tilde(&space.cwd)),
                    status,
                    tag: "",
                    target: Some(Target::Space(i)),
                }
            })
            .collect()
    }

    pub(super) fn spaces_key(&mut self, overlay: &mut ListOverlay, key: KeyEvent) -> Outcome {
        if let Some(prompt) = &mut overlay.prompt {
            match key.code {
                KeyCode::Esc => overlay.prompt = None,
                KeyCode::Enter => {
                    let name = prompt.text.trim().to_owned();
                    let taken = self
                        .model
                        .find_space(&name)
                        .is_some_and(|i| Some(i) != prompt.rename);
                    if !valid_name(&name) || taken {
                        return Outcome::Keep;
                    }
                    match prompt.rename {
                        Some(index) => {
                            self.model.spaces[index].name = name;
                            overlay.prompt = None;
                        }
                        None => {
                            let cwd = self.new_window_cwd();
                            self.open_space(&cwd, Some(&name));
                            return Outcome::Close;
                        }
                    }
                }
                KeyCode::Backspace => {
                    prompt.text.pop();
                }
                KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    prompt.text.clear()
                }
                KeyCode::Char(c) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                    prompt.text.push(c)
                }
                _ => {}
            }
            return Outcome::Keep;
        }
        let deleting = std::mem::take(&mut overlay.confirm_delete);
        match key.code {
            KeyCode::Esc => return Outcome::Close,
            KeyCode::Enter => return Outcome::Run(Target::Space(overlay.selected)),
            KeyCode::Up | KeyCode::BackTab | KeyCode::Char('k') => {
                overlay.selected = overlay.selected.saturating_sub(1);
            }
            KeyCode::Down | KeyCode::Tab | KeyCode::Char('j') => overlay.selected += 1,
            KeyCode::Char('n' | 'N') => {
                overlay.prompt = Some(Prompt {
                    text: String::new(),
                    rename: None,
                });
            }
            KeyCode::Char('e' | 'E') => {
                overlay.prompt = Some(Prompt {
                    text: self.model.spaces[overlay.selected].name.clone(),
                    rename: Some(overlay.selected),
                });
            }
            KeyCode::Char('d' | 'D') if deleting => {
                self.model.delete_space(overlay.selected);
                self.relayout();
            }
            KeyCode::Char('d' | 'D') => overlay.confirm_delete = self.model.spaces.len() > 1,
            _ => {}
        }
        Outcome::Keep
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_follow_illium_rules() {
        assert!(valid_name("relay"));
        assert!(!valid_name(""));
        assert!(!valid_name("two words"));
        assert!(!valid_name("it's"));
        assert!(!valid_name(&"x".repeat(25)));
    }
}
