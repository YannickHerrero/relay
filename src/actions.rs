//! Commands as `keybindings.toml` writes them, after Illium's `illiumctl`
//! syntax: `window focus left`, `window resize --width -5%`.

use crate::layout::{Axis, Direction};

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    WindowFocus(Direction),
    WindowMove(Direction),
    /// Signed fraction of the split, `0.05` for `+5%`.
    WindowResize(Axis, f32),
    /// Keys resize the focused window until Escape.
    ResizeMode,
    WindowFullscreen,
    WindowToggleFloat,
    WindowSetTiling,
    WindowClose,
    WindowRename,
    WindowMoveWorkspace {
        workspace: usize,
        follow: bool,
    },
    Workspace(usize),
    WorkspaceNextActive,
    /// Next or previous workspace number, wrapping between 9 and 1.
    WorkspaceStep(i32),
    WorkspaceRecent,
    SpaceNext,
    SpaceRecent,
    /// A program alias from the config, `terminal` being the shell.
    Spawn(String),
    Popup(String),
    Palette,
    SpacePicker,
    Keybindings,
    Detach,
    ConfigReload,
    ServerStop,
}

impl Action {
    pub fn parse(text: &str) -> Option<Action> {
        let words: Vec<&str> = text.split_whitespace().collect();
        let direction = |w: &str| match w {
            "left" => Some(Direction::Left),
            "right" => Some(Direction::Right),
            "up" => Some(Direction::Up),
            "down" => Some(Direction::Down),
            _ => None,
        };
        let workspace = |w: &str| w.parse::<usize>().ok().filter(|n| (1..=9).contains(n));
        Some(match words.as_slice() {
            ["window", "focus", d] => Action::WindowFocus(direction(d)?),
            ["window", "move", d] => Action::WindowMove(direction(d)?),
            ["window", "resize", flag, amount] => {
                let axis = match *flag {
                    "--width" => Axis::Vertical,
                    "--height" => Axis::Horizontal,
                    _ => return None,
                };
                let percent: f32 = amount.strip_suffix('%')?.parse().ok()?;
                Action::WindowResize(axis, percent / 100.0)
            }
            ["window", "resize-mode"] => Action::ResizeMode,
            ["window", "toggle-fullscreen"] => Action::WindowFullscreen,
            ["window", "toggle-float"] => Action::WindowToggleFloat,
            ["window", "set-tiling"] => Action::WindowSetTiling,
            ["window", "close"] => Action::WindowClose,
            ["window", "rename"] => Action::WindowRename,
            ["window", "move-workspace", n] => Action::WindowMoveWorkspace {
                workspace: workspace(n)?,
                follow: false,
            },
            ["window", "move-workspace", n, "--follow"] => Action::WindowMoveWorkspace {
                workspace: workspace(n)?,
                follow: true,
            },
            ["workspace", "next-active"] => Action::WorkspaceNextActive,
            ["workspace", "next"] => Action::WorkspaceStep(1),
            ["workspace", "prev"] => Action::WorkspaceStep(-1),
            ["workspace", "recent"] => Action::WorkspaceRecent,
            ["workspace", n] => Action::Workspace(workspace(n)?),
            ["space", "next"] => Action::SpaceNext,
            ["space", "recent"] => Action::SpaceRecent,
            ["space", "picker"] => Action::SpacePicker,
            ["spawn", alias] => Action::Spawn((*alias).to_owned()),
            ["popup", command @ ..] if !command.is_empty() => Action::Popup(command.join(" ")),
            ["palette", "toggle"] => Action::Palette,
            ["keybindings", "toggle"] => Action::Keybindings,
            ["client", "detach"] => Action::Detach,
            ["config", "reload"] => Action::ConfigReload,
            ["server", "stop"] => Action::ServerStop,
            _ => return None,
        })
    }

    pub fn describe(&self) -> String {
        let dir = |d: &Direction| format!("{d:?}").to_lowercase();
        match self {
            Action::WindowFocus(d) => format!("Focus {}", dir(d)),
            Action::WindowMove(d) => format!("Swap {}", dir(d)),
            Action::WindowResize(axis, delta) => format!(
                "{} {}{:.0}%",
                if *axis == Axis::Vertical {
                    "Width"
                } else {
                    "Height"
                },
                if *delta >= 0.0 { "+" } else { "" },
                delta * 100.0
            ),
            Action::ResizeMode => "Resize mode".into(),
            Action::WindowFullscreen => "Fullscreen".into(),
            Action::WindowToggleFloat => "Float / tile".into(),
            Action::WindowSetTiling => "Tile".into(),
            Action::WindowClose => "Close window".into(),
            Action::WindowRename => "Rename window".into(),
            Action::WindowMoveWorkspace { workspace, follow } => format!(
                "Move to workspace {workspace}{}",
                if *follow { " and follow" } else { "" }
            ),
            Action::Workspace(n) => format!("Workspace {n}"),
            Action::WorkspaceNextActive => "Next occupied workspace".into(),
            Action::WorkspaceStep(1) => "Next workspace".into(),
            Action::WorkspaceStep(_) => "Previous workspace".into(),
            Action::WorkspaceRecent => "Recent workspace".into(),
            Action::SpaceNext => "Next space".into(),
            Action::SpaceRecent => "Recent space".into(),
            Action::Spawn(alias) if alias == "terminal" => "New terminal".into(),
            Action::Spawn(alias) => format!("Run {alias}"),
            Action::Popup(command) => format!("Popup: {command}"),
            Action::Palette => "Palette".into(),
            Action::SpacePicker => "Spaces".into(),
            Action::Keybindings => "Keybindings".into(),
            Action::Detach => "Detach".into(),
            Action::ConfigReload => "Reload config".into(),
            Action::ServerStop => "Stop server".into(),
        }
    }

    /// Resize keys keep the leader open so they can be repeated.
    pub fn repeatable(&self) -> bool {
        matches!(self, Action::WindowResize(..))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_illium_commands() {
        assert_eq!(
            Action::parse("window focus left"),
            Some(Action::WindowFocus(Direction::Left))
        );
        assert_eq!(
            Action::parse("window resize --width -5%"),
            Some(Action::WindowResize(Axis::Vertical, -0.05))
        );
        assert_eq!(
            Action::parse("window move-workspace 3 --follow"),
            Some(Action::WindowMoveWorkspace {
                workspace: 3,
                follow: true
            })
        );
        assert_eq!(Action::parse("workspace 9"), Some(Action::Workspace(9)));
        assert_eq!(
            Action::parse("workspace prev"),
            Some(Action::WorkspaceStep(-1))
        );
    }

    #[test]
    fn popup_keeps_its_whole_command() {
        assert_eq!(
            Action::parse("popup git log --oneline"),
            Some(Action::Popup("git log --oneline".into()))
        );
    }

    #[test]
    fn rejects_out_of_range_and_unknown() {
        assert_eq!(Action::parse("workspace 10"), None);
        assert_eq!(Action::parse("window focus sideways"), None);
        assert_eq!(Action::parse("dance"), None);
    }

    #[test]
    fn describes_resize() {
        assert_eq!(
            Action::parse("window resize --height +5%")
                .unwrap()
                .describe(),
            "Height +5%"
        );
    }
}
