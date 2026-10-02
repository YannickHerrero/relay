use std::fs;
use std::path::PathBuf;

/// Foreground process group of the terminal `pid` is attached to.
pub fn foreground_pgid(pid: u32) -> Option<u32> {
    stat_fields(pid)?.get(5)?.parse().ok()
}

pub fn cwd(pid: u32) -> Option<PathBuf> {
    fs::read_link(format!("/proc/{pid}/cwd")).ok()
}

pub(super) fn group_members(pgid: u32) -> Vec<u32> {
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

/// The kernel's name for `pid` and its command line.
pub(super) fn name_and_argv(pid: u32) -> Option<(String, Vec<String>)> {
    let comm = fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
    let cmdline = fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
    let argv = cmdline
        .split(|b| *b == 0)
        .filter(|a| !a.is_empty())
        .map(|a| String::from_utf8_lossy(a).into_owned())
        .collect();
    Some((comm.trim().to_owned(), argv))
}

/// Fields of /proc/<pid>/stat after the parenthesized command name, which may
/// itself contain spaces: state, ppid, pgrp, session, tty_nr, tpgid, ...
fn stat_fields(pid: u32) -> Option<Vec<String>> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rest = &stat[stat.rfind(')')? + 1..];
    Some(rest.split_whitespace().map(str::to_owned).collect())
}
