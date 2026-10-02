use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::keys::{Chord, Modifier};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Motion {
    None,
    Basic,
    #[default]
    Full,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Config {
    pub modifier: Modifier,
    pub leader: String,
    pub motion: Motion,
    /// Empty means `$SHELL`.
    pub shell: String,
    pub projects: Projects,
    /// Palette entries: name to command, run in a new window.
    pub programs: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Projects {
    pub roots: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            modifier: Modifier::Ctrl,
            leader: "Ctrl+B".into(),
            motion: Motion::Full,
            shell: String::new(),
            projects: Projects::default(),
            programs: BTreeMap::from([
                ("claude".into(), "claude".into()),
                ("pi".into(), "pi".into()),
                ("lazygit".into(), "lazygit".into()),
            ]),
        }
    }
}

impl Default for Projects {
    fn default() -> Self {
        Projects {
            roots: vec!["~/dev".into()],
        }
    }
}

impl Config {
    pub fn load() -> anyhow::Result<Config> {
        let path = config_dir().join("config.toml");
        match std::fs::read_to_string(&path) {
            Ok(text) => {
                toml::from_str(&text).map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn leader_chord(&self) -> Chord {
        Chord::parse(&self.leader, self.modifier)
            .or_else(|| Chord::parse("Ctrl+B", self.modifier))
            .expect("default leader parses")
    }

    pub fn shell(&self) -> String {
        if !self.shell.is_empty() {
            return self.shell.clone();
        }
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }

    pub fn project_roots(&self) -> Vec<PathBuf> {
        self.projects.roots.iter().map(|r| expand_home(r)).collect()
    }
}

pub fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| "/".into())
}

pub fn expand_home(path: &str) -> PathBuf {
    match path.strip_prefix("~") {
        Some(rest) => home().join(rest.trim_start_matches('/')),
        None => PathBuf::from(path),
    }
}

fn dir_from_env(var: &str, xdg: &str, fallback: &str) -> PathBuf {
    if let Some(dir) = std::env::var_os(var) {
        return dir.into();
    }
    let base = std::env::var_os(xdg)
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(fallback));
    base.join("relay")
}

pub fn config_dir() -> PathBuf {
    dir_from_env("RELAY_CONFIG_HOME", "XDG_CONFIG_HOME", ".config")
}

pub fn state_dir() -> PathBuf {
    dir_from_env("RELAY_STATE_HOME", "XDG_STATE_HOME", ".local/state")
}

pub fn socket_path() -> PathBuf {
    std::env::var_os("RELAY_SOCKET")
        .map(PathBuf::from)
        .unwrap_or_else(|| state_dir().join("relay.sock"))
}

/// Replaces the home directory prefix with `~` for display.
pub fn tilde(path: &Path) -> String {
    match path.strip_prefix(home()) {
        Ok(rest) if rest.as_os_str().is_empty() => "~".into(),
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => path.display().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_config_keeps_defaults() {
        let config: Config =
            toml::from_str("modifier = \"alt\"\n[projects]\nroots = [\"~/x\"]").unwrap();
        assert_eq!(config.modifier, Modifier::Alt);
        assert_eq!(config.motion, Motion::Full);
        assert_eq!(config.project_roots(), vec![home().join("x")]);
        assert!(config.programs.contains_key("claude"));
    }

    #[test]
    fn bad_leader_falls_back_to_ctrl_b() {
        let config = Config {
            leader: "Nope+Z".into(),
            ..Config::default()
        };
        assert_eq!(config.leader_chord().to_string(), "Ctrl+B");
    }

    #[test]
    fn tilde_shortens_home() {
        assert_eq!(tilde(&home().join("dev/relay")), "~/dev/relay");
        assert_eq!(tilde(Path::new("/etc")), "/etc");
    }
}
