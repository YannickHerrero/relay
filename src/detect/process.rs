//! Finds the agent running in the foreground of a pane, from /proc on Linux
//! and libproc on macOS.

use std::fs;
use std::path::Path;

use super::Agent;

#[cfg_attr(target_os = "linux", path = "process/linux.rs")]
#[cfg_attr(target_os = "macos", path = "process/macos.rs")]
mod os;
pub use os::{cwd, foreground_pgid};
use os::{group_members, name_and_argv};

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

fn process_agent(pid: u32) -> Option<Agent> {
    let (name, argv) = name_and_argv(pid)?;
    identify(&name, &argv)
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
    fn own_cwd_is_readable() {
        let cwd = cwd(std::process::id()).unwrap();
        assert_eq!(cwd, std::env::current_dir().unwrap());
    }

    #[test]
    fn own_process_group_lists_this_process() {
        let pgid = unsafe { libc::getpgrp() } as u32;
        assert!(group_members(pgid).contains(&std::process::id()));
    }

    #[test]
    fn own_command_line_is_readable() {
        let (name, argv) = name_and_argv(std::process::id()).unwrap();
        assert!(!name.is_empty());
        assert_eq!(argv.first(), std::env::args().next().as_ref());
    }
}
