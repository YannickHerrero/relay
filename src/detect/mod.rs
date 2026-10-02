pub mod manifest;
pub mod process;
pub mod tracker;

use std::sync::OnceLock;

use manifest::Manifest;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Agent {
    Claude,
    Pi,
}

impl Agent {
    pub fn name(self) -> &'static str {
        match self {
            Agent::Claude => "claude",
            Agent::Pi => "pi",
        }
    }

    pub fn manifest(self) -> &'static Manifest {
        static CLAUDE: OnceLock<Manifest> = OnceLock::new();
        static PI: OnceLock<Manifest> = OnceLock::new();
        let (cell, source) = match self {
            Agent::Claude => (&CLAUDE, include_str!("manifests/claude.toml")),
            Agent::Pi => (&PI, include_str!("manifests/pi.toml")),
        };
        cell.get_or_init(|| Manifest::parse(source).expect("bundled manifest is valid"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use manifest::{AgentState, Snapshot};

    fn detect(agent: Agent, text: &str, title: &str) -> AgentState {
        agent
            .manifest()
            .detect(&Snapshot {
                text: text.to_owned(),
                osc_title: title.to_owned(),
                osc_progress: String::new(),
            })
            .state
    }

    #[test]
    fn bundled_manifests_parse() {
        Agent::Claude.manifest();
        Agent::Pi.manifest();
    }

    #[test]
    fn claude_spinner_title_is_working() {
        assert_eq!(detect(Agent::Claude, "", "⠂ Refactor"), AgentState::Working);
    }

    #[test]
    fn claude_idle_title_is_idle() {
        assert_eq!(detect(Agent::Claude, "", "✳ Claude Code"), AgentState::Idle);
    }

    #[test]
    fn claude_permission_prompt_is_blocked() {
        let screen = "\
 Bash command
   rm -rf build
 Do you want to proceed?
 ❯ 1. Yes
   2. No
 Esc to cancel";
        assert_eq!(detect(Agent::Claude, screen, ""), AgentState::Blocked);
    }

    #[test]
    fn claude_prompt_box_is_idle() {
        let screen = "\
● Done.
────────────────────────────────
❯
────────────────────────────────
  ? for shortcuts";
        assert_eq!(detect(Agent::Claude, screen, ""), AgentState::Idle);
    }

    #[test]
    fn pi_working_line_is_working() {
        assert_eq!(detect(Agent::Pi, "⠋ Working", ""), AgentState::Working);
        assert_eq!(detect(Agent::Pi, "> hello", ""), AgentState::Idle);
    }
}
