//! Palette rows: windows, spaces, projects, programs and actions.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::Server;
use super::chrome;
use super::overlay::{Row, Target};
use crate::actions::Action;
use crate::config::tilde;
use crate::detect::process;
use crate::keymap::DEFAULTS;

/// Actions without a default key that the palette still offers.
const UNBOUND_COMMANDS: &[&str] = &["space next", "window set-tiling"];

impl Server {
    pub(super) fn palette_rows(&self) -> Vec<Row> {
        let mut rows = self.window_rows();
        for (i, space) in self.model.spaces.iter().enumerate() {
            if i != self.model.active {
                rows.push(Row {
                    label: space.name.clone(),
                    detail: tilde(&space.cwd),
                    status: None,
                    tag: "space",
                    target: Some(Target::Space(i)),
                });
            }
        }
        for path in self.projects() {
            rows.push(Row {
                label: path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                detail: tilde(&path),
                status: None,
                tag: "project",
                target: Some(Target::Project(path)),
            });
        }
        for (name, command) in &self.config.programs {
            rows.push(Row {
                label: name.clone(),
                detail: command.clone(),
                status: None,
                tag: "program",
                target: Some(Target::Program(command.clone())),
            });
        }
        let mut seen = HashSet::new();
        let unbound = UNBOUND_COMMANDS.iter();
        for command in DEFAULTS.iter().map(|(_, c)| c).chain(unbound) {
            let Some(action) = Action::parse(command) else {
                continue;
            };
            let label = action.describe();
            if !seen.insert(label.clone()) || matches!(action, Action::Palette) {
                continue;
            }
            let shortcut = self
                .keymap
                .listing
                .iter()
                .find(|(_, a)| *a == action)
                .map(|(k, _)| k.clone())
                .unwrap_or_default();
            rows.push(Row {
                label,
                detail: shortcut,
                status: None,
                tag: "action",
                target: Some(Target::Action(action)),
            });
        }
        rows
    }

    /// Every window of every space, the current space first.
    pub(super) fn window_rows(&self) -> Vec<Row> {
        let mut spaces: Vec<usize> = (0..self.model.spaces.len()).collect();
        spaces.sort_by_key(|i| *i != self.model.active);
        let mut rows = Vec::new();
        for s in spaces {
            let space = &self.model.spaces[s];
            for (n, ws) in space.workspaces.iter().enumerate() {
                for id in ws.windows() {
                    let Some(window) = self.windows.get(&id) else {
                        continue;
                    };
                    let cwd = window
                        .pane
                        .pid()
                        .and_then(process::cwd)
                        .map(|p| tilde(&p))
                        .unwrap_or_default();
                    rows.push(Row {
                        label: chrome::title(window),
                        detail: format!("{} · {} · {cwd}", space.name, n + 1),
                        status: window.tracker.status(),
                        tag: "window",
                        target: Some(Target::Window(id)),
                    });
                }
            }
        }
        rows
    }

    /// Directories directly under the configured project roots.
    fn projects(&self) -> Vec<PathBuf> {
        let mut projects: Vec<PathBuf> = self
            .config
            .project_roots()
            .iter()
            .filter_map(|root| std::fs::read_dir(root).ok())
            .flatten()
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
            .map(|e| e.path())
            .collect();
        projects.sort();
        projects.dedup();
        projects
    }

    /// Focuses the space named after `path` (or `name`), creating it there
    /// with a first terminal when it does not exist.
    pub(super) fn open_space(&mut self, path: &Path, name: Option<&str>) -> usize {
        let name = name.map(str::to_owned).unwrap_or_else(|| {
            path.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "space".into())
        });
        if let Some(index) = self.model.find_space(&name) {
            self.switch_space(index);
            return index;
        }
        let index = self.model.create_space(&name, path.to_path_buf());
        self.switch_space(index);
        self.spawn_shell(path.to_path_buf(), None);
        index
    }

    pub(super) fn key_rows(&self) -> Vec<Row> {
        self.keymap
            .listing
            .iter()
            .map(|(keys, action)| Row {
                label: action.describe(),
                detail: keys.clone(),
                status: None,
                tag: "",
                target: Some(Target::Action(action.clone())),
            })
            .collect()
    }
}
