use std::path::PathBuf;

use ratatui::layout::Rect;

use super::Server;
use super::overlay::ListKind;
use super::rename::RenameTarget;
use crate::actions::Action;
use crate::detect;
use crate::layout::{self, Axis};
use crate::model::{Location, WORKSPACES, WindowId};
use crate::pane::Spawn;

impl Server {
    pub(super) fn execute(&mut self, action: Action) {
        match action {
            Action::WindowFocus(dir) => {
                if let Some(id) = self.neighbor(dir, false) {
                    self.focus(id);
                }
            }
            Action::WindowMove(dir) => {
                if let (Some(a), Some(b)) = (self.model.focused(), self.neighbor(dir, true)) {
                    self.model.swap(a, b);
                    self.relayout();
                }
            }
            Action::WindowResize(axis, delta) => self.resize_focused(axis, delta),
            Action::ResizeMode => self.resize_mode = true,
            Action::WindowFullscreen => {
                if let Some(id) = self.model.focused() {
                    let ws = self.model.workspace_mut();
                    ws.fullscreen = if ws.fullscreen == Some(id) {
                        None
                    } else {
                        Some(id)
                    };
                    self.relayout();
                }
            }
            Action::WindowToggleFloat => {
                if let Some(id) = self.model.focused() {
                    self.toggle_float(id);
                }
            }
            Action::WindowSetTiling => {
                if let Some(id) = self
                    .model
                    .focused()
                    .filter(|id| self.model.is_floating(*id))
                {
                    self.toggle_float(id);
                }
            }
            Action::WindowClose => {
                if let Some(id) = self.model.focused() {
                    self.close_window(id);
                }
            }
            Action::WindowRename => {
                if let Some(id) = self.model.focused() {
                    self.start_rename(RenameTarget::Window(id));
                }
            }
            Action::WindowMoveWorkspace { workspace, follow } => {
                if let Some(id) = self.model.focused() {
                    self.model.move_to_workspace(id, workspace - 1, follow);
                    self.relayout();
                }
            }
            Action::Workspace(n) => self.switch_workspace(n - 1),
            Action::WorkspaceNextActive => {
                if let Some(n) = self.model.space().next_occupied() {
                    self.switch_workspace(n);
                }
            }
            Action::WorkspaceStep(step) => {
                let n = WORKSPACES as i32;
                let next = (self.model.space().active as i32 + step).rem_euclid(n);
                self.switch_workspace(next as usize);
            }
            Action::WorkspaceRename(index) => {
                let at = Location {
                    space: self.model.active,
                    workspace: index.unwrap_or(self.model.space().active),
                };
                self.start_rename(RenameTarget::Workspace(at));
            }
            Action::WorkspaceRecent => self.switch_workspace(self.model.space().recent),
            Action::SpaceNext => {
                let next = (self.model.active + 1) % self.model.spaces.len();
                self.switch_space(next);
            }
            Action::SpaceRecent => self.switch_space(self.model.recent),
            Action::Spawn(alias) => {
                let cwd = self.new_window_cwd();
                if alias == "terminal" {
                    self.spawn_shell(cwd, None);
                } else {
                    let command = self.config.programs.get(&alias).cloned().unwrap_or(alias);
                    self.spawn_shell(cwd, Some(&command));
                }
            }
            Action::Popup(command) => self.popup(&command),
            Action::Palette => self.open_list(ListKind::Palette),
            Action::Keybindings => self.open_list(ListKind::Keys),
            Action::Agents => self.open_list(ListKind::Agents),
            Action::Sidebar => self.toggle_sidebar(),
            Action::SpacePicker => self.open_list(ListKind::Spaces),
            Action::Detach => self.detach(),
            Action::ConfigReload => self.reload_config(),
            Action::ServerStop => self.quit = true,
        }
        self.dirty = true;
    }

    pub(super) fn focus(&mut self, id: WindowId) {
        self.model.reveal(id);
        if let Some(window) = self.windows.get_mut(&id) {
            window.tracker.mark_seen();
        }
        self.dirty = true;
    }

    fn switch_workspace(&mut self, index: usize) {
        self.model.space_mut().switch(index);
        self.mark_visible_seen();
    }

    pub(super) fn switch_space(&mut self, index: usize) {
        self.model.switch_space(index);
        self.mark_visible_seen();
    }

    /// Every window of the workspace on screen has been seen, which clears
    /// their done badges.
    pub(super) fn mark_visible_seen(&mut self) {
        let visible: Vec<WindowId> = self.model.workspace().windows().collect();
        for id in visible {
            if let Some(window) = self.windows.get_mut(&id) {
                window.tracker.mark_seen();
            }
        }
        self.dirty = true;
    }

    /// Nearest window of the current workspace in `dir` from the focused one.
    fn neighbor(&self, dir: layout::Direction, tiled_only: bool) -> Option<WindowId> {
        let ws = self.model.workspace();
        let focused = ws.focused?;
        if ws.fullscreen.is_some() {
            return None;
        }
        let ids: Vec<WindowId> = if tiled_only {
            ws.tiled.clone()
        } else {
            ws.windows().collect()
        };
        let rects: Vec<Rect> = ids.iter().map(|id| self.windows[id].rect).collect();
        let from = ids.iter().position(|id| *id == focused)?;
        layout::neighbor(&rects, from, dir).map(|i| ids[i])
    }

    pub(super) fn resize_focused(&mut self, axis: Axis, delta: f32) {
        let Some(id) = self.model.focused() else {
            return;
        };
        let area = self.work_area();
        if self.model.is_floating(id) {
            if let Some(rect) = self
                .windows
                .get_mut(&id)
                .and_then(|w| w.float_rect.as_mut())
            {
                match axis {
                    Axis::Vertical => {
                        let step = (area.width as f32 * delta).round() as i32;
                        rect.width = (rect.width as i32 + step)
                            .clamp(layout::MIN_WIDTH as i32, area.width as i32)
                            as u16;
                    }
                    Axis::Horizontal => {
                        let step = (area.height as f32 * delta).round() as i32;
                        rect.height = (rect.height as i32 + step)
                            .clamp(layout::MIN_HEIGHT as i32, area.height as i32)
                            as u16;
                    }
                }
            }
        } else {
            let ws = self.model.workspace_mut();
            let Some(index) = ws.tiled.iter().position(|w| *w == id) else {
                return;
            };
            let (_, splits) = layout::fibonacci_with_splits(area, ws.tiled.len(), &ws.ratios);
            layout::resize(&splits, &mut ws.ratios, index, axis, delta);
        }
        self.relayout();
    }

    /// Resize mode: moves the focused window's edge toward `dir`.
    pub(super) fn nudge_focused(&mut self, dir: layout::Direction) {
        const STEP: f32 = 0.05;
        let Some(id) = self.model.focused() else {
            return;
        };
        if self.model.is_floating(id) {
            let (axis, delta) = match dir {
                layout::Direction::Left => (Axis::Vertical, -STEP),
                layout::Direction::Right => (Axis::Vertical, STEP),
                layout::Direction::Up => (Axis::Horizontal, -STEP),
                layout::Direction::Down => (Axis::Horizontal, STEP),
            };
            self.resize_focused(axis, delta);
            return;
        }
        let area = self.work_area();
        let ws = self.model.workspace_mut();
        let Some(index) = ws.tiled.iter().position(|w| *w == id) else {
            return;
        };
        let (rects, splits) = layout::fibonacci_with_splits(area, ws.tiled.len(), &ws.ratios);
        layout::move_edge(&splits, &rects, &mut ws.ratios, index, dir, STEP);
        self.relayout();
    }

    fn toggle_float(&mut self, id: WindowId) {
        if self.windows.get(&id).is_some_and(|w| w.popup) {
            return;
        }
        self.model.toggle_float(id);
        if let Some(window) = self.windows.get_mut(&id) {
            window.float_rect = None;
        }
        self.relayout();
    }

    /// Working directory for a new window: the focused window's, else the
    /// space's.
    pub(super) fn new_window_cwd(&self) -> PathBuf {
        self.model
            .focused()
            .and_then(|id| self.windows.get(&id))
            .and_then(|w| w.pane.pid())
            .and_then(detect::process::cwd)
            .unwrap_or_else(|| self.model.space().cwd.clone())
    }

    pub(super) fn popup(&mut self, command: &str) {
        let cwd = self.new_window_cwd();
        let at = Location {
            space: self.model.active,
            workspace: self.model.space().active,
        };
        let area = self.work_area();
        let spawn = Spawn {
            program: self.config.shell(),
            args: vec!["-c".into(), command.into()],
            cwd,
            env: vec![],
        };
        if let Some(id) = self.spawn_window(at, spawn, true, true)
            && let Some(window) = self.windows.get_mut(&id)
        {
            let (w, h) = (area.width * 4 / 5, area.height * 7 / 10);
            window.float_rect = Some(Rect::new(
                area.x + (area.width - w) / 2,
                area.y + (area.height - h) / 2,
                w,
                h,
            ));
            self.relayout();
        }
    }

    pub(super) fn reload_config(&mut self) {
        match crate::config::Config::load() {
            Ok(config) => self.config = config,
            Err(e) => eprintln!("relay: {e}"),
        }
        self.keymap = super::load_keymap(&self.config);
        self.dirty = true;
    }
}
