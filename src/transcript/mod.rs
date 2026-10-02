//! Agent conversations read from the session files Claude Code and pi write,
//! turned into messages and actions a remote client can show.

mod claude;
mod pi;

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::detect::Agent;

const POLL: Duration = Duration::from_millis(300);
/// Lines of a diff kept per action.
const MAX_DIFF_LINES: usize = 400;
/// End of a command's output kept per action.
const MAX_OUTPUT_LINES: usize = 40;
const MAX_OUTPUT_CHARS: usize = 4000;
const MAX_TARGET_CHARS: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Entry {
    User { text: String, at: Option<String> },
    Assistant { text: String, at: Option<String> },
    Action(Action),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Action {
    /// The agent's id for the tool call.
    pub id: String,
    /// Tool name in lowercase: read, edit, write, bash...
    pub tool: String,
    /// What the tool works on: a path relative to the session's directory,
    /// a command, a pattern.
    pub target: Option<String>,
    pub status: ActionStatus,
    pub at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<Diff>,
    /// The end of a command's output.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionStatus {
    Running,
    Ok,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Diff {
    pub added: usize,
    pub removed: usize,
    pub hunks: Vec<Hunk>,
    /// Some lines were left out of `hunks`.
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Hunk {
    pub old_start: u64,
    pub new_start: u64,
    /// Each line starts with `+`, `-` or a space.
    pub lines: Vec<String>,
}

/// Entries from `from` on replace what the reader had.
#[derive(Debug, Clone, PartialEq)]
pub struct Change {
    pub from: usize,
    pub entries: Vec<Entry>,
}

impl Entry {
    pub fn at(&self) -> Option<&str> {
        match self {
            Entry::User { at, .. } | Entry::Assistant { at, .. } => at.as_deref(),
            Entry::Action(action) => action.at.as_deref(),
        }
    }
}

/// Applies a change to a copy of the entries.
pub fn apply(entries: &mut Vec<Entry>, change: Change) {
    entries.truncate(change.from);
    entries.extend(change.entries);
}

/// Entries as they are parsed, remembering the first one that changed since
/// the last `take`.
#[derive(Debug, Default)]
struct Builder {
    entries: Vec<Entry>,
    /// Tool call id to the index of its action.
    calls: HashMap<String, usize>,
    /// Tool call arguments kept until the result arrives.
    inputs: HashMap<String, Value>,
    cwd: Option<PathBuf>,
    changed: Option<usize>,
}

impl Builder {
    fn mark(&mut self, index: usize) {
        self.changed = Some(self.changed.map_or(index, |c| c.min(index)));
    }

    fn push(&mut self, entry: Entry) {
        self.mark(self.entries.len());
        self.entries.push(entry);
    }

    fn text(&mut self, user: bool, text: String, at: Option<String>) {
        let text = text.trim().to_owned();
        if text.is_empty() {
            return;
        }
        self.push(if user {
            Entry::User { text, at }
        } else {
            Entry::Assistant { text, at }
        });
    }

    fn call(&mut self, id: &str, tool: &str, input: &Value, at: Option<String>) {
        self.calls.insert(id.to_owned(), self.entries.len());
        self.inputs.insert(id.to_owned(), input.clone());
        let target = target(input, self.cwd.as_deref());
        self.push(Entry::Action(Action {
            id: id.to_owned(),
            tool: tool.to_lowercase(),
            target,
            status: ActionStatus::Running,
            at,
            diff: None,
            output: None,
        }));
    }

    /// Records a tool call's outcome; `finish` fills in the details from the
    /// call's arguments.
    fn result(&mut self, id: &str, error: bool, finish: impl FnOnce(&mut Action, &Value)) {
        let Some(&index) = self.calls.get(id) else {
            return;
        };
        let input = self.inputs.remove(id).unwrap_or(Value::Null);
        if let Some(Entry::Action(action)) = self.entries.get_mut(index) {
            action.status = if error {
                ActionStatus::Error
            } else {
                ActionStatus::Ok
            };
            finish(action, &input);
            self.mark(index);
        }
    }

    fn take(&mut self) -> Option<Change> {
        let from = self.changed.take()?;
        Some(Change {
            from,
            entries: self.entries[from..].to_vec(),
        })
    }
}

/// What a tool call works on, from the argument names Claude Code and pi use.
fn target(input: &Value, cwd: Option<&Path>) -> Option<String> {
    let path = ["file_path", "path", "notebook_path"]
        .iter()
        .find_map(|k| input[k].as_str());
    if let Some(path) = path {
        let relative = cwd
            .and_then(|cwd| Path::new(path).strip_prefix(cwd).ok())
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| path.to_owned());
        return Some(clip(&relative, MAX_TARGET_CHARS));
    }
    [
        "command",
        "pattern",
        "url",
        "query",
        "description",
        "prompt",
    ]
    .iter()
    .find_map(|k| input[k].as_str())
    .map(|s| clip(s.lines().next().unwrap_or(s), MAX_TARGET_CHARS))
}

fn clip(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((end, _)) => format!("{}…", &text[..end]),
        None => text.to_owned(),
    }
}

/// The last lines of a command's output.
fn output_tail(text: &str) -> Option<String> {
    let text = text.trim_end();
    if text.is_empty() {
        return None;
    }
    let lines: Vec<&str> = text.lines().collect();
    let tail = lines[lines.len().saturating_sub(MAX_OUTPUT_LINES)..].join("\n");
    let start = tail
        .char_indices()
        .rev()
        .nth(MAX_OUTPUT_CHARS)
        .map_or(0, |(i, _)| i);
    Some(tail[start..].to_owned())
}

/// A diff from hunks of lines prefixed with `+`, `-` or a space.
fn diff(hunks: impl IntoIterator<Item = Hunk>) -> Option<Diff> {
    let mut diff = Diff {
        added: 0,
        removed: 0,
        hunks: Vec::new(),
        truncated: false,
    };
    let mut kept = 0;
    for mut hunk in hunks {
        diff.added += hunk.lines.iter().filter(|l| l.starts_with('+')).count();
        diff.removed += hunk.lines.iter().filter(|l| l.starts_with('-')).count();
        if kept >= MAX_DIFF_LINES {
            diff.truncated = true;
            continue;
        }
        if kept + hunk.lines.len() > MAX_DIFF_LINES {
            hunk.lines.truncate(MAX_DIFF_LINES - kept);
            diff.truncated = true;
        }
        kept += hunk.lines.len();
        diff.hunks.push(hunk);
    }
    (diff.added + diff.removed > 0).then_some(diff)
}

/// A new file as a diff that adds every line.
fn created(content: &str) -> Option<Diff> {
    diff([Hunk {
        old_start: 0,
        new_start: 1,
        lines: content.lines().map(|l| format!("+{l}")).collect(),
    }])
}

/// Hunks of a unified diff (`@@ -a,b +c,d @@`).
fn unified(patch: &str) -> Vec<Hunk> {
    let mut hunks: Vec<Hunk> = Vec::new();
    for line in patch.lines() {
        if let Some(header) = line.strip_prefix("@@ ") {
            let mut ranges = header.split_whitespace();
            let start = |range: Option<&str>| {
                range
                    .and_then(|r| r[1..].split(',').next()?.parse().ok())
                    .unwrap_or(0)
            };
            let old_start = start(ranges.next());
            let new_start = start(ranges.next());
            hunks.push(Hunk {
                old_start,
                new_start,
                lines: Vec::new(),
            });
        } else if let Some(hunk) = hunks.last_mut()
            && (line.starts_with(['+', '-', ' ']) || line.is_empty())
            && !line.starts_with("+++")
            && !line.starts_with("---")
        {
            hunk.lines.push(if line.is_empty() {
                " ".into()
            } else {
                line.into()
            });
        }
    }
    hunks
}

/// Where an agent keeps a session: Claude Code names files after the
/// session id, pi reports the file itself or puts the id at the end of the
/// file name.
fn locate(agent: Agent, session: &str) -> Option<PathBuf> {
    if Path::new(session).is_absolute() {
        return Some(PathBuf::from(session)).filter(|p| p.is_file());
    }
    let (root, suffix) = match agent {
        Agent::Claude => (claude::projects_dir(), format!("{session}.jsonl")),
        Agent::Pi => (pi::sessions_dir(), format!("_{session}.jsonl")),
    };
    std::fs::read_dir(root)
        .ok()?
        .flatten()
        .filter_map(|dir| std::fs::read_dir(dir.path()).ok())
        .flatten()
        .flatten()
        .map(|file| file.path())
        .find(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n == suffix || (agent == Agent::Pi && n.ends_with(&suffix)))
        })
}

/// Follows a session file on its own thread until dropped.
pub struct Watcher {
    stop: Arc<AtomicBool>,
}

impl Drop for Watcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Reads the session from the start, then as it grows, sending every change.
/// The file may not exist yet when the agent has just started.
pub fn watch(
    agent: Agent,
    session: String,
    send: impl Fn(Change) -> bool + Send + 'static,
) -> Watcher {
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    std::thread::spawn(move || {
        let mut builder = Builder::default();
        let mut path = None;
        let mut offset = 0u64;
        let mut partial = Vec::new();
        while !stopped.load(Ordering::Relaxed) {
            if path.is_none() {
                path = locate(agent, &session);
            }
            if let Some(path) = &path {
                match read_from(path, &mut offset) {
                    Some(bytes) => partial.extend(bytes),
                    // Truncated or replaced: start over.
                    None => {
                        builder = Builder::default();
                        builder.mark(0);
                        offset = 0;
                        partial.clear();
                    }
                }
                let end = partial
                    .iter()
                    .rposition(|b| *b == b'\n')
                    .map_or(0, |i| i + 1);
                for line in partial[..end].split(|b| *b == b'\n') {
                    if let Ok(value) = serde_json::from_slice::<Value>(line) {
                        match agent {
                            Agent::Claude => claude::feed(&mut builder, &value),
                            Agent::Pi => pi::feed(&mut builder, &value),
                        }
                    }
                }
                partial.drain(..end);
                if let Some(change) = builder.take()
                    && !send(change)
                {
                    return;
                }
            }
            std::thread::sleep(POLL);
        }
    });
    Watcher { stop }
}

/// Bytes past `offset`, moving it; None when the file shrank.
fn read_from(path: &Path, offset: &mut u64) -> Option<Vec<u8>> {
    let Ok(mut file) = File::open(path) else {
        return Some(Vec::new());
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    if len < *offset {
        return None;
    }
    let mut bytes = Vec::new();
    if file.seek(SeekFrom::Start(*offset)).is_ok() && file.read_to_end(&mut bytes).is_ok() {
        *offset += bytes.len() as u64;
    }
    Some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unified_patches_split_into_hunks() {
        let patch =
            "--- a.rs\n+++ a.rs\n@@ -6,3 +6,4 @@\n x\n-y\n+z\n+w\n@@ -20 +21 @@\n-old\n+new\n";
        let hunks = unified(patch);
        assert_eq!(hunks.len(), 2);
        assert_eq!((hunks[0].old_start, hunks[0].new_start), (6, 6));
        assert_eq!(hunks[0].lines, [" x", "-y", "+z", "+w"]);
        assert_eq!((hunks[1].old_start, hunks[1].new_start), (20, 21));
        let diff = diff(hunks).unwrap();
        assert_eq!((diff.added, diff.removed), (3, 2));
    }

    #[test]
    fn long_diffs_are_cut_but_counted() {
        let content = (0..1000).map(|i| format!("line {i}\n")).collect::<String>();
        let diff = created(&content).unwrap();
        assert_eq!(diff.added, 1000);
        assert_eq!(diff.hunks[0].lines.len(), MAX_DIFF_LINES);
        assert!(diff.truncated);
    }

    #[test]
    fn targets_are_relative_to_the_session() {
        let cwd = Path::new("/home/u/dev/relay");
        let input = json!({"file_path": "/home/u/dev/relay/src/main.rs"});
        assert_eq!(target(&input, Some(cwd)).as_deref(), Some("src/main.rs"));
        let input = json!({"command": "cargo test\ncargo build"});
        assert_eq!(target(&input, Some(cwd)).as_deref(), Some("cargo test"));
    }

    #[test]
    fn outputs_keep_their_end() {
        let text = (0..100).map(|i| format!("{i}\n")).collect::<String>();
        let tail = output_tail(&text).unwrap();
        assert!(tail.starts_with("60\n") && tail.ends_with("99"));
    }

    #[test]
    fn changes_start_at_the_first_touched_entry() {
        let mut b = Builder::default();
        b.text(true, "hi".into(), None);
        b.call("t1", "Bash", &json!({"command": "ls"}), None);
        assert_eq!(b.take().unwrap().from, 0);
        b.text(false, "listing".into(), None);
        b.result("t1", false, |a, _| a.output = Some("a b".into()));
        let change = b.take().unwrap();
        assert_eq!(change.from, 1);
        assert_eq!(change.entries.len(), 2);
        let mut copy = Vec::new();
        apply(
            &mut copy,
            Change {
                from: 0,
                entries: b.entries.clone(),
            },
        );
        assert_eq!(copy, b.entries);
    }
}
