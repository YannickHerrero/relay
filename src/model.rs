//! Spaces, their nine workspaces and the windows in them, without the
//! terminals: what goes where and what has focus.

use std::path::PathBuf;

pub type WindowId = u64;

pub const WORKSPACES: usize = 9;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Workspace {
    /// Tiling order.
    pub tiled: Vec<WindowId>,
    /// Stacking order, topmost last.
    pub floating: Vec<WindowId>,
    pub focused: Option<WindowId>,
    pub ratios: Vec<f32>,
    pub fullscreen: Option<WindowId>,
    /// Shown after the number in the bar.
    pub name: Option<String>,
}

impl Workspace {
    pub fn is_empty(&self) -> bool {
        self.tiled.is_empty() && self.floating.is_empty()
    }

    pub fn contains(&self, id: WindowId) -> bool {
        self.tiled.contains(&id) || self.floating.contains(&id)
    }

    pub fn windows(&self) -> impl Iterator<Item = WindowId> + '_ {
        self.tiled.iter().chain(self.floating.iter()).copied()
    }

    fn remove(&mut self, id: WindowId) -> bool {
        let tiled_at = self.tiled.iter().position(|w| *w == id);
        let floating_at = self.floating.iter().position(|w| *w == id);
        match (tiled_at, floating_at) {
            (Some(i), _) => {
                self.tiled.remove(i);
                if self.ratios.len() > i {
                    self.ratios.remove(i);
                }
            }
            (None, Some(i)) => {
                self.floating.remove(i);
            }
            (None, None) => return false,
        }
        if self.fullscreen == Some(id) {
            self.fullscreen = None;
        }
        if self.focused == Some(id) {
            let next_tiled = tiled_at.map(|i| i.min(self.tiled.len().saturating_sub(1)));
            self.focused = self
                .floating
                .last()
                .copied()
                .filter(|_| floating_at.is_some())
                .or_else(|| next_tiled.and_then(|i| self.tiled.get(i).copied()))
                .or_else(|| self.tiled.last().copied())
                .or_else(|| self.floating.last().copied());
        }
        true
    }

    fn insert(&mut self, id: WindowId, floating: bool) {
        if floating {
            self.floating.push(id);
        } else {
            self.tiled.push(id);
        }
        self.focused = Some(id);
    }

    /// Brings a floating window to the top and focuses any window.
    pub fn focus(&mut self, id: WindowId) {
        if let Some(i) = self.floating.iter().position(|w| *w == id) {
            let w = self.floating.remove(i);
            self.floating.push(w);
        }
        if self.contains(id) {
            self.focused = Some(id);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Space {
    pub name: String,
    pub cwd: PathBuf,
    pub workspaces: Vec<Workspace>,
    /// 0-based.
    pub active: usize,
    pub recent: usize,
}

impl Space {
    pub fn new(name: impl Into<String>, cwd: PathBuf) -> Space {
        Space {
            name: name.into(),
            cwd,
            workspaces: vec![Workspace::default(); WORKSPACES],
            active: 0,
            recent: 0,
        }
    }

    pub fn workspace(&self) -> &Workspace {
        &self.workspaces[self.active]
    }

    pub fn workspace_mut(&mut self) -> &mut Workspace {
        &mut self.workspaces[self.active]
    }

    pub fn switch(&mut self, index: usize) {
        if index != self.active && index < WORKSPACES {
            self.recent = self.active;
            self.active = index;
        }
    }

    /// Next occupied workspace after the active one, wrapping.
    pub fn next_occupied(&self) -> Option<usize> {
        (1..WORKSPACES)
            .map(|step| (self.active + step) % WORKSPACES)
            .find(|i| !self.workspaces[*i].is_empty())
    }

    pub fn windows(&self) -> impl Iterator<Item = WindowId> + '_ {
        self.workspaces.iter().flat_map(Workspace::windows)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Location {
    pub space: usize,
    pub workspace: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Model {
    pub spaces: Vec<Space>,
    pub active: usize,
    pub recent: usize,
}

impl Model {
    pub fn new(first: Space) -> Model {
        Model {
            spaces: vec![first],
            active: 0,
            recent: 0,
        }
    }

    pub fn space(&self) -> &Space {
        &self.spaces[self.active]
    }

    pub fn space_mut(&mut self) -> &mut Space {
        &mut self.spaces[self.active]
    }

    pub fn workspace(&self) -> &Workspace {
        self.space().workspace()
    }

    pub fn workspace_mut(&mut self) -> &mut Workspace {
        self.space_mut().workspace_mut()
    }

    pub fn focused(&self) -> Option<WindowId> {
        self.workspace().focused
    }

    pub fn locate(&self, id: WindowId) -> Option<Location> {
        self.spaces.iter().enumerate().find_map(|(space, s)| {
            s.workspaces
                .iter()
                .position(|w| w.contains(id))
                .map(|workspace| Location { space, workspace })
        })
    }

    pub fn is_floating(&self, id: WindowId) -> bool {
        self.locate(id).is_some_and(|l| {
            self.spaces[l.space].workspaces[l.workspace]
                .floating
                .contains(&id)
        })
    }

    pub fn add(&mut self, at: Location, id: WindowId, floating: bool) {
        self.spaces[at.space].workspaces[at.workspace].insert(id, floating);
    }

    pub fn remove(&mut self, id: WindowId) -> Option<Location> {
        let at = self.locate(id)?;
        self.spaces[at.space].workspaces[at.workspace].remove(id);
        Some(at)
    }

    /// Shows the window: switches to its space and workspace and focuses it.
    pub fn reveal(&mut self, id: WindowId) {
        let Some(at) = self.locate(id) else {
            return;
        };
        self.switch_space(at.space);
        let space = self.space_mut();
        space.switch(at.workspace);
        space.workspace_mut().focus(id);
    }

    pub fn move_to_workspace(&mut self, id: WindowId, workspace: usize, follow: bool) {
        let Some(from) = self.locate(id) else {
            return;
        };
        if from.workspace == workspace {
            return;
        }
        let floating = self.is_floating(id);
        self.remove(id);
        self.add(
            Location {
                space: from.space,
                workspace,
            },
            id,
            floating,
        );
        if follow {
            self.reveal(id);
        }
    }

    pub fn toggle_float(&mut self, id: WindowId) {
        let Some(at) = self.locate(id) else {
            return;
        };
        let floating = self.is_floating(id);
        let ws = &mut self.spaces[at.space].workspaces[at.workspace];
        ws.remove(id);
        ws.insert(id, !floating);
    }

    pub fn swap(&mut self, a: WindowId, b: WindowId) {
        let ws = self.workspace_mut();
        let (Some(i), Some(j)) = (
            ws.tiled.iter().position(|w| *w == a),
            ws.tiled.iter().position(|w| *w == b),
        ) else {
            return;
        };
        ws.tiled.swap(i, j);
    }

    pub fn switch_space(&mut self, index: usize) {
        if index != self.active && index < self.spaces.len() {
            self.recent = self.active;
            self.active = index;
        }
    }

    pub fn find_space(&self, name: &str) -> Option<usize> {
        self.spaces.iter().position(|s| s.name == name)
    }

    pub fn create_space(&mut self, name: &str, cwd: PathBuf) -> usize {
        self.spaces.push(Space::new(name, cwd));
        self.spaces.len() - 1
    }

    /// Deletes a space without closing anything: its windows join the
    /// current space (the recent one if deleting the current) on the same
    /// workspace numbers. The last space cannot be deleted.
    pub fn delete_space(&mut self, index: usize) -> bool {
        if self.spaces.len() < 2 || index >= self.spaces.len() {
            return false;
        }
        if index == self.active {
            let target = if self.recent != index {
                self.recent
            } else {
                (index + 1) % self.spaces.len()
            };
            self.switch_space(target);
        }
        let removed = self.spaces.remove(index);
        let fix = |i: usize| if i > index { i - 1 } else { i };
        self.active = fix(self.active);
        self.recent = fix(self.recent).min(self.spaces.len() - 1);
        let target = self.active;
        for (n, ws) in removed.workspaces.into_iter().enumerate() {
            let dest = &mut self.spaces[target].workspaces[n];
            dest.tiled.extend(ws.tiled);
            dest.floating.extend(ws.floating);
            if dest.focused.is_none() {
                dest.focused = ws.focused;
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model() -> Model {
        Model::new(Space::new("main", PathBuf::from("/")))
    }

    fn here(m: &Model) -> Location {
        Location {
            space: m.active,
            workspace: m.space().active,
        }
    }

    #[test]
    fn adding_focuses_and_removing_refocuses_a_neighbor() {
        let mut m = model();
        for id in 1..=3 {
            let at = here(&m);
            m.add(at, id, false);
        }
        assert_eq!(m.focused(), Some(3));
        m.workspace_mut().focus(2);
        m.remove(2);
        assert_eq!(m.focused(), Some(3));
        m.remove(3);
        assert_eq!(m.focused(), Some(1));
    }

    #[test]
    fn closing_a_float_focuses_the_next_float() {
        let mut m = model();
        let at = here(&m);
        m.add(at, 1, false);
        m.add(at, 2, true);
        m.add(at, 3, true);
        m.remove(3);
        assert_eq!(m.focused(), Some(2));
    }

    #[test]
    fn workspace_history_and_next_occupied() {
        let mut m = model();
        let space = m.space_mut();
        space.switch(4);
        assert_eq!((space.active, space.recent), (4, 0));
        space.switch(4);
        assert_eq!(space.recent, 0);
        space.workspaces[2].tiled.push(9);
        assert_eq!(space.next_occupied(), Some(2));
    }

    #[test]
    fn move_and_follow() {
        let mut m = model();
        let at = here(&m);
        m.add(at, 1, false);
        m.move_to_workspace(1, 5, true);
        assert_eq!(m.space().active, 5);
        assert_eq!(m.focused(), Some(1));
        assert!(m.space().workspaces[0].is_empty());
    }

    #[test]
    fn toggling_float_moves_between_lists() {
        let mut m = model();
        let at = here(&m);
        m.add(at, 1, false);
        m.toggle_float(1);
        assert!(m.is_floating(1));
        m.toggle_float(1);
        assert!(!m.is_floating(1));
        assert_eq!(m.focused(), Some(1));
    }

    #[test]
    fn deleting_a_space_keeps_its_windows() {
        let mut m = model();
        let other = m.create_space("work", PathBuf::from("/tmp"));
        m.switch_space(other);
        m.space_mut().switch(3);
        let at = here(&m);
        m.add(at, 7, false);
        assert!(m.delete_space(other));
        assert_eq!(m.spaces.len(), 1);
        assert_eq!(
            m.locate(7),
            Some(Location {
                space: 0,
                workspace: 3
            })
        );
        assert!(!m.delete_space(0));
    }
}
