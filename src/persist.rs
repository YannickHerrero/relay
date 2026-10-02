//! What survives a server restart: the layout and where each window was.
//! Processes do not survive; windows come back as shells in their cwd.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::detect::Agent;

pub const VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct State {
    pub version: u32,
    pub active: usize,
    pub recent: usize,
    pub spaces: Vec<SpaceState>,
    #[serde(default)]
    pub agents_current_space: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpaceState {
    pub name: String,
    pub cwd: PathBuf,
    pub active: usize,
    pub recent: usize,
    pub workspaces: Vec<WorkspaceState>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct WorkspaceState {
    #[serde(default)]
    pub ratios: Vec<f32>,
    /// Tiled windows first, in tiling order, then floating ones.
    #[serde(default)]
    pub windows: Vec<WindowState>,
    #[serde(default)]
    pub focused: Option<usize>,
    #[serde(default)]
    pub fullscreen: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WindowState {
    pub cwd: PathBuf,
    #[serde(default)]
    pub floating: Option<[u16; 4]>,
    #[serde(default)]
    pub agent: Option<Agent>,
    /// Claude session id or pi session file, to resume the conversation.
    #[serde(default)]
    pub session: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

pub fn path() -> PathBuf {
    crate::config::state_dir().join("state.json")
}

pub fn load(path: &Path) -> Option<State> {
    let text = std::fs::read_to_string(path).ok()?;
    match serde_json::from_str::<State>(&text) {
        Ok(state) if state.version == VERSION && !state.spaces.is_empty() => Some(state),
        Ok(_) => None,
        Err(e) => {
            eprintln!("relay: ignoring {}: {e}", path.display());
            None
        }
    }
}

/// Writes atomically so a crash never leaves half a file.
pub fn save(path: &Path, state: &State) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(state)?)?;
    std::fs::rename(tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_a_file() {
        let state = State {
            version: VERSION,
            active: 0,
            recent: 0,
            agents_current_space: true,
            spaces: vec![SpaceState {
                name: "main".into(),
                cwd: "/tmp".into(),
                active: 2,
                recent: 0,
                workspaces: vec![WorkspaceState {
                    ratios: vec![0.6],
                    windows: vec![WindowState {
                        cwd: "/tmp".into(),
                        floating: None,
                        agent: Some(Agent::Claude),
                        session: Some("abc".into()),
                        name: Some("api".into()),
                    }],
                    focused: Some(0),
                    fullscreen: None,
                }],
            }],
        };
        let dir = std::env::temp_dir().join(format!("relay-persist-{}", std::process::id()));
        let file = dir.join("state.json");
        save(&file, &state).unwrap();
        assert_eq!(load(&file), Some(state));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn other_versions_are_ignored() {
        let dir = std::env::temp_dir().join(format!("relay-persist-v-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("state.json");
        std::fs::write(&file, r#"{"version":99,"active":0,"recent":0,"spaces":[]}"#).unwrap();
        assert_eq!(load(&file), None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
