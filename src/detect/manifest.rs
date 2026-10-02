//! Screen detection manifests. The rule format and its semantics follow
//! herdr's detection manifests (Apache-2.0), so its manifests load unchanged.

use regex::Regex;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentState {
    Idle,
    Working,
    Blocked,
    Unknown,
}

/// What the detector reads from one pane.
#[derive(Debug, Default, Clone)]
pub struct Snapshot {
    pub text: String,
    pub osc_title: String,
    pub osc_progress: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Detection {
    pub state: AgentState,
    pub rule: Option<String>,
    /// The screen shows something (a transcript viewer, a picker) that must
    /// not change the published state.
    pub skip: bool,
    pub visible_idle: bool,
    pub visible_blocker: bool,
}

pub struct Manifest {
    rules: Vec<Rule>,
}

struct Rule {
    id: String,
    state: AgentState,
    priority: i64,
    region: Region,
    skip: bool,
    visible_idle: bool,
    visible_blocker: bool,
    gate: Gate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Region {
    WholeRecent,
    OscTitle,
    OscProgress,
    BottomNonEmptyLines(usize),
    LastNonEmptyAbovePromptBox,
    AfterLastHorizontalRule,
    PromptBoxBody,
}

#[derive(Default)]
struct Gate {
    contains: Vec<String>,
    regex: Vec<Regex>,
    line_regex: Vec<Regex>,
    all: Vec<Gate>,
    any: Vec<Gate>,
    not: Vec<Gate>,
}

#[derive(Deserialize)]
struct ManifestDef {
    #[serde(default)]
    rules: Vec<RuleDef>,
}

#[derive(Deserialize)]
struct RuleDef {
    id: String,
    state: AgentState,
    #[serde(default)]
    priority: i64,
    region: Option<String>,
    #[serde(default)]
    skip_state_update: bool,
    #[serde(default)]
    visible_idle: bool,
    #[serde(default)]
    visible_blocker: bool,
    #[serde(flatten)]
    gate: GateDef,
}

#[derive(Deserialize, Default)]
struct GateDef {
    #[serde(default)]
    contains: Vec<String>,
    #[serde(default)]
    regex: Vec<String>,
    #[serde(default)]
    line_regex: Vec<String>,
    #[serde(default)]
    all: Vec<GateDef>,
    #[serde(default)]
    any: Vec<GateDef>,
    #[serde(default)]
    not: Vec<GateDef>,
}

impl Manifest {
    pub fn parse(source: &str) -> anyhow::Result<Manifest> {
        let def: ManifestDef = toml::from_str(source)?;
        let rules = def
            .rules
            .into_iter()
            .map(|rule| {
                Ok(Rule {
                    region: parse_region(rule.region.as_deref())
                        .ok_or_else(|| anyhow::anyhow!("rule {}: unknown region", rule.id))?,
                    gate: compile(rule.gate)?,
                    id: rule.id,
                    state: rule.state,
                    priority: rule.priority,
                    skip: rule.skip_state_update,
                    visible_idle: rule.visible_idle && rule.state == AgentState::Idle,
                    visible_blocker: rule.visible_blocker && rule.state == AgentState::Blocked,
                })
            })
            .collect::<anyhow::Result<_>>()?;
        Ok(Manifest { rules })
    }

    /// Highest-priority matching rule; the earlier rule wins a tie. A known
    /// agent whose screen matches nothing is idle.
    pub fn detect(&self, snapshot: &Snapshot) -> Detection {
        let lower_text = snapshot.text.to_lowercase();
        let mut best: Option<&Rule> = None;
        for rule in &self.rules {
            if best.is_some_and(|b| b.priority >= rule.priority) {
                continue;
            }
            let text = region_text(rule.region, snapshot);
            let lower = if rule.region == Region::WholeRecent {
                lower_text.clone()
            } else {
                text.to_lowercase()
            };
            if rule.gate.matches(&text, &lower) {
                best = Some(rule);
            }
        }
        match best {
            Some(rule) => Detection {
                state: rule.state,
                rule: Some(rule.id.clone()),
                skip: rule.skip,
                visible_idle: rule.visible_idle,
                visible_blocker: rule.visible_blocker,
            },
            None => Detection {
                state: AgentState::Idle,
                rule: None,
                skip: false,
                visible_idle: false,
                visible_blocker: false,
            },
        }
    }
}

fn parse_region(region: Option<&str>) -> Option<Region> {
    Some(match region.unwrap_or("whole_recent") {
        "whole_recent" => Region::WholeRecent,
        "osc_title" => Region::OscTitle,
        "osc_progress" => Region::OscProgress,
        "last_non_empty_above_prompt_box" => Region::LastNonEmptyAbovePromptBox,
        "after_last_horizontal_rule" => Region::AfterLastHorizontalRule,
        "prompt_box_body" => Region::PromptBoxBody,
        other => {
            let n = other
                .strip_prefix("bottom_non_empty_lines(")?
                .strip_suffix(')')?
                .parse()
                .ok()?;
            Region::BottomNonEmptyLines(n)
        }
    })
}

fn compile(def: GateDef) -> anyhow::Result<Gate> {
    let regexes = |list: Vec<String>| -> anyhow::Result<Vec<Regex>> {
        list.iter().map(|r| Ok(Regex::new(r)?)).collect()
    };
    let gates = |list: Vec<GateDef>| -> anyhow::Result<Vec<Gate>> {
        list.into_iter().map(compile).collect()
    };
    Ok(Gate {
        contains: def.contains.iter().map(|s| s.to_lowercase()).collect(),
        regex: regexes(def.regex)?,
        line_regex: regexes(def.line_regex)?,
        all: gates(def.all)?,
        any: gates(def.any)?,
        not: gates(def.not)?,
    })
}

impl Gate {
    fn matches(&self, text: &str, lower: &str) -> bool {
        self.contains
            .iter()
            .all(|needle| lower.contains(needle.as_str()))
            && self.regex.iter().all(|r| r.is_match(text))
            && self
                .line_regex
                .iter()
                .all(|r| text.lines().any(|line| r.is_match(line)))
            && self.all.iter().all(|g| g.matches(text, lower))
            && (self.any.is_empty() || self.any.iter().any(|g| g.matches(text, lower)))
            && !self.not.iter().any(|g| g.matches(text, lower))
    }
}

fn region_text(region: Region, snapshot: &Snapshot) -> String {
    let text = snapshot.text.as_str();
    let lines: Vec<&str> = text.lines().collect();
    match region {
        Region::WholeRecent => text.to_owned(),
        Region::OscTitle => snapshot.osc_title.clone(),
        Region::OscProgress => snapshot.osc_progress.clone(),
        Region::BottomNonEmptyLines(n) => {
            let mut seen = 0;
            let start = lines.iter().rposition(|line| {
                if !line.trim().is_empty() {
                    seen += 1;
                }
                seen == n
            });
            match start {
                Some(start) => join(&lines[start..]),
                None if seen > 0 => text.to_owned(),
                None => String::new(),
            }
        }
        Region::AfterLastHorizontalRule => {
            match lines.iter().rposition(|l| is_horizontal_rule(l)) {
                Some(i) => join(&lines[i + 1..]),
                None => text.to_owned(),
            }
        }
        Region::PromptBoxBody => match prompt_box_top(&lines) {
            Some(top) => {
                let body = &lines[top + 1..];
                let end = body
                    .iter()
                    .position(|l| is_horizontal_rule(l))
                    .unwrap_or(body.len());
                join(&body[..end])
            }
            None => String::new(),
        },
        Region::LastNonEmptyAbovePromptBox => {
            let above = match prompt_box_top(&lines) {
                Some(top) => &lines[..top],
                None => &lines[..],
            };
            above
                .iter()
                .rev()
                .find(|l| !l.trim().is_empty())
                .map(|l| (*l).to_owned())
                .unwrap_or_default()
        }
    }
}

fn join(lines: &[&str]) -> String {
    lines.join("\n")
}

/// Index of the second rule line from the bottom: the top border of a prompt
/// box whose bottom border is the last rule.
fn prompt_box_top(lines: &[&str]) -> Option<usize> {
    lines
        .iter()
        .enumerate()
        .rev()
        .filter(|(_, l)| is_horizontal_rule(l))
        .nth(1)
        .map(|(i, _)| i)
}

fn is_horizontal_rule(line: &str) -> bool {
    let t = line.trim();
    if !t.starts_with('─') {
        return false;
    }
    let dashes = t.chars().take_while(|c| *c == '─').count();
    let suffix = t.trim_start_matches('─').trim_start();
    suffix.is_empty() || dashes >= 3
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(text: &str) -> Snapshot {
        Snapshot {
            text: text.to_owned(),
            ..Default::default()
        }
    }

    const MANIFEST: &str = r#"
[[rules]]
id = "busy"
state = "working"
priority = 100
region = "bottom_non_empty_lines(2)"
contains = ["Esc To Interrupt"]

[[rules]]
id = "ask"
state = "blocked"
priority = 200
visible_blocker = true
contains = ["proceed?"]
any = [{ line_regex = ['(?i)^\s*1\. yes'] }, { contains = ["always"] }]
not = [{ contains = ["cancelled"] }]

[[rules]]
id = "prompt"
state = "idle"
priority = 50
region = "prompt_box_body"
visible_idle = true
line_regex = ['^\s*❯']
"#;

    fn manifest() -> Manifest {
        Manifest::parse(MANIFEST).unwrap()
    }

    #[test]
    fn contains_is_case_insensitive() {
        let d = manifest().detect(&snapshot("thinking\nesc to interrupt"));
        assert_eq!(d.state, AgentState::Working);
    }

    #[test]
    fn bottom_region_ignores_older_lines() {
        let d = manifest().detect(&snapshot("esc to interrupt\na\n\nb\nc"));
        assert_eq!(d.state, AgentState::Idle);
        assert_eq!(d.rule, None);
    }

    #[test]
    fn higher_priority_wins_and_any_gates() {
        let d = manifest().detect(&snapshot(
            "Do you want to proceed?\n 1. Yes\nesc to interrupt",
        ));
        assert_eq!(d.state, AgentState::Blocked);
        assert!(d.visible_blocker);
    }

    #[test]
    fn not_gate_rejects() {
        let d = manifest().detect(&snapshot("proceed?\n1. yes\ncancelled"));
        assert_eq!(d.state, AgentState::Idle);
    }

    #[test]
    fn prompt_box_body_sits_between_the_last_two_rules() {
        let text = "output\n────────\n❯ hello\n────────\n  ? for shortcuts";
        let d = manifest().detect(&snapshot(text));
        assert_eq!(d.rule.as_deref(), Some("prompt"));
        assert!(d.visible_idle);
    }

    #[test]
    fn short_dash_runs_with_text_are_not_rules() {
        assert!(is_horizontal_rule("────"));
        assert!(is_horizontal_rule("─── title"));
        assert!(!is_horizontal_rule("─x"));
        assert!(!is_horizontal_rule("text"));
    }

    #[test]
    fn unknown_region_is_rejected() {
        let bad =
            "[[rules]]\nid = \"x\"\nstate = \"idle\"\nregion = \"nowhere\"\ncontains = [\"a\"]";
        assert!(Manifest::parse(bad).is_err());
    }
}
