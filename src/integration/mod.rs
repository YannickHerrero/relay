//! Agent integrations: hooks that tell relay an agent's session (Claude
//! Code) or its whole lifecycle (pi).

use std::path::PathBuf;

use anyhow::{Context, bail};
use serde_json::{Value, json};

use crate::config::home;

const PI_EXTENSION: &str = include_str!("relay-agent-state.ts");
const CLAUDE_HOOK: &str = "[ -n \"$RELAY_BIN\" ] && \"$RELAY_BIN\" hook claude || true";

pub fn claude_dir() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".claude"))
}

pub fn pi_dir() -> PathBuf {
    std::env::var_os("PI_CODING_AGENT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".pi/agent"))
}

pub fn install(agent: &str) -> anyhow::Result<String> {
    match agent {
        "claude" => install_claude(),
        "pi" => install_pi(),
        other => bail!("no integration for {other}; try claude or pi"),
    }
}

/// Adds a SessionStart hook to Claude Code's settings.json, keeping a backup.
fn install_claude() -> anyhow::Result<String> {
    let dir = claude_dir();
    if !dir.is_dir() {
        bail!(
            "{} does not exist; is Claude Code installed?",
            dir.display()
        );
    }
    let path = dir.join("settings.json");
    let mut settings: Value = match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            .with_context(|| format!("{} is not valid JSON", path.display()))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(e) => return Err(e.into()),
    };
    if add_claude_hook(&mut settings)? {
        if path.exists() {
            std::fs::copy(&path, dir.join("settings.json.relay-backup"))?;
        }
        std::fs::write(&path, serde_json::to_string_pretty(&settings)? + "\n")?;
        Ok(format!("added a SessionStart hook to {}", path.display()))
    } else {
        Ok(format!("{} already has the relay hook", path.display()))
    }
}

/// Returns whether the settings changed.
fn add_claude_hook(settings: &mut Value) -> anyhow::Result<bool> {
    let root = settings
        .as_object_mut()
        .context("settings.json is not an object")?;
    let hooks = root
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .context("\"hooks\" is not an object")?;
    let start = hooks
        .entry("SessionStart")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .context("\"hooks.SessionStart\" is not an array")?;
    let present = start.iter().any(|group| {
        group["hooks"].as_array().is_some_and(|hs| {
            hs.iter().any(|h| {
                h["command"]
                    .as_str()
                    .is_some_and(|c| c.contains("hook claude"))
            })
        })
    });
    if present {
        return Ok(false);
    }
    start.push(json!({
        "matcher": "^(startup|resume|clear|compact|fork)$",
        "hooks": [{ "type": "command", "command": CLAUDE_HOOK, "timeout": 10 }],
    }));
    Ok(true)
}

fn install_pi() -> anyhow::Result<String> {
    let dir = pi_dir().join("extensions");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("relay-agent-state.ts");
    std::fs::write(&path, PI_EXTENSION)?;
    Ok(format!("installed {}", path.display()))
}

/// The session id in a Claude Code SessionStart hook payload, unless it
/// comes from a subagent.
pub fn claude_session(payload: &str) -> Option<String> {
    let input: Value = serde_json::from_str(payload).ok()?;
    if input["hook_event_name"] != "SessionStart"
        || input.get("agent_id").is_some_and(|a| !a.is_null())
    {
        return None;
    }
    input["session_id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_hook_is_added_once() {
        let mut settings = json!({ "hooks": { "Stop": [] }, "model": "opus" });
        assert!(add_claude_hook(&mut settings).unwrap());
        assert!(!add_claude_hook(&mut settings).unwrap());
        assert_eq!(
            settings["hooks"]["SessionStart"].as_array().unwrap().len(),
            1
        );
        assert_eq!(settings["model"], "opus");
    }

    #[test]
    fn session_comes_from_session_start_only() {
        let start = r#"{"hook_event_name":"SessionStart","session_id":"abc","source":"startup"}"#;
        assert_eq!(claude_session(start).as_deref(), Some("abc"));
        let sub = r#"{"hook_event_name":"SessionStart","session_id":"abc","agent_id":"x"}"#;
        assert_eq!(claude_session(sub), None);
        assert_eq!(
            claude_session(r#"{"hook_event_name":"Stop","session_id":"abc"}"#),
            None
        );
        assert_eq!(claude_session("not json"), None);
    }
}
