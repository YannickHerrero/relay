//! Finds the agent running in the foreground of a pane, from /proc.

use std::fs;
use std::path::{Path, PathBuf};

use super::Agent;

/// Foreground process group of the terminal `pid` is attached to.
pub fn foreground_pgid(pid: u32) -> Option<u32> {
    stat_fields(pid)?.get(5)?.parse().ok()
}

pub fn cwd(pid: u32) -> Option<PathBuf> {
    fs::read_link(format!("/proc/{pid}/cwd")).ok()
}

/// The agent in process group `pgid`: its leader first, then any member.
pub fn agent_in_group(pgid: u32) -> Option<Agent> {
    if let Some(agent) = process_agent(pgid) {
        return Some(agent);
    }
    group_members(pgid)
        .into_iter()
        .filter(|pid| *pid != pgid)
        .find_map(process_agent)
}

/// Fields of /proc/<pid>/stat after the parenthesized command name, which may
/// itself contain spaces: state, ppid, pgrp, session, tty_nr, tpgid, ...
fn stat_fields(pid: u32) -> Option<Vec<String>> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rest = &stat[stat.rfind(')')? + 1..];
    Some(rest.split_whitespace().map(str::to_owned).collect())
}

fn group_members(pgid: u32) -> Vec<u32> {
    let Ok(entries) = fs::read_dir("/proc") else {
        return Vec::new();
    };
    entries
        .filter_map(|e| e.ok()?.file_name().to_str()?.parse::<u32>().ok())
        .filter(|pid| {
            stat_fields(*pid)
                .and_then(|f| f.get(2)?.parse::<u32>().ok())
                .is_some_and(|pgrp| pgrp == pgid)
        })
        .collect()
}

fn process_agent(pid: u32) -> Option<Agent> {
    let comm = fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
    let cmdline = fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
    let argv: Vec<String> = cmdline
        .split(|b| *b == 0)
        .filter(|a| !a.is_empty())
        .map(|a| String::from_utf8_lossy(a).into_owned())
        .collect();
    identify(comm.trim(), &argv)
}

/// Agent named by a process: a runtime or shell (node, sh...) is looked
/// through to the script it runs.
pub fn identify(comm: &str, argv: &[String]) -> Option<Agent> {
    let effective = argv.first().map(String::as_str).unwrap_or(comm);
    if is_runtime(&basename(effective)) || is_runtime(&basename(comm)) {
        return script_argument(argv).and_then(|script| agent_from_path(&script));
    }
    agent_from_path(effective).or_else(|| agent_from_name(comm))
}

fn is_runtime(name: &str) -> bool {
    matches!(
        name,
        "sh" | "bash" | "zsh" | "fish" | "dash" | "node" | "nodejs" | "bun" | "deno"
    ) || name.starts_with("python")
}

/// First non-flag argument of a runtime command line, skipping the values of
/// flags that take one.
fn script_argument(argv: &[String]) -> Option<String> {
    let mut args = argv.iter().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--" => return args.next().cloned(),
            "-e" | "-p" | "-c" | "--eval" | "--print" => return None,
            "-r" | "--require" | "--import" | "--loader" | "--experimental-loader" => {
                args.next();
            }
            a if a.starts_with('-') => {}
            a => return Some(a.to_owned()),
        }
    }
    None
}

fn agent_from_path(token: &str) -> Option<Agent> {
    if let Some(agent) = agent_from_name(&basename(token)) {
        return Some(agent);
    }
    let lower = token.to_lowercase().replace('\\', "/");
    if lower.ends_with("node_modules/@earendil-works/pi-coding-agent/dist/cli.js")
        || lower.ends_with("node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js")
    {
        return Some(Agent::Pi);
    }
    let resolved = fs::canonicalize(token).ok()?;
    agent_from_name(&basename(resolved.to_str()?))
}

fn agent_from_name(name: &str) -> Option<Agent> {
    let name = name.to_lowercase();
    let stem = [".exe", ".cmd", ".js"]
        .iter()
        .find_map(|ext| name.strip_suffix(ext))
        .unwrap_or(&name);
    match stem {
        "claude" | "claude-code" => Some(Agent::Claude),
        "pi" => Some(Agent::Pi),
        _ => None,
    }
}

fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(args: &[&str]) -> Vec<String> {
        args.iter().map(|a| (*a).to_owned()).collect()
    }

    #[test]
    fn native_claude_binary() {
        assert_eq!(identify("claude", &argv(&["claude"])), Some(Agent::Claude));
    }

    #[test]
    fn node_running_a_claude_script() {
        let a = argv(&["node", "--no-warnings", "/usr/lib/node_modules/.bin/claude"]);
        assert_eq!(identify("node", &a), Some(Agent::Claude));
    }

    #[test]
    fn node_running_the_pi_package() {
        let a = argv(&[
            "node",
            "/home/u/.npm/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
        ]);
        assert_eq!(identify("node", &a), Some(Agent::Pi));
    }

    #[test]
    fn node_eval_is_not_an_agent() {
        assert_eq!(identify("node", &argv(&["node", "-e", "pi"])), None);
    }

    #[test]
    fn plain_shell_is_not_an_agent() {
        assert_eq!(identify("zsh", &argv(&["-zsh"])), None);
        assert_eq!(identify("vim", &argv(&["vim", "pi.txt"])), None);
    }

    #[test]
    fn own_process_group_is_readable() {
        let pid = std::process::id();
        assert!(stat_fields(pid).is_some_and(|f| f.len() > 5));
    }
}
