//! Claude Code transcripts: one JSON object per line, under
//! `~/.claude/projects/<directory>/<session>.jsonl`.

use std::path::PathBuf;

use serde_json::Value;

use super::{Action, ActionStatus, Builder, Hunk, created, diff, output_tail};

pub fn projects_dir() -> PathBuf {
    crate::integration::claude_dir().join("projects")
}

pub(super) fn feed(builder: &mut Builder, line: &Value) {
    // Subagent turns.
    if line["isSidechain"] == true {
        return;
    }
    if let Some(cwd) = line["cwd"].as_str() {
        builder.cwd = Some(cwd.into());
    }
    let at = line["timestamp"].as_str().map(str::to_owned);
    let content = &line["message"]["content"];
    match line["type"].as_str() {
        Some("user") if line["isMeta"] != true => {
            if let Some(text) = content.as_str() {
                if let Some(text) = prompt(text) {
                    builder.text(true, text, at);
                }
                return;
            }
            let mut texts = Vec::new();
            for block in content.as_array().into_iter().flatten() {
                match block["type"].as_str() {
                    Some("tool_result") => {
                        let id = block["tool_use_id"].as_str().unwrap_or_default();
                        let error = block["is_error"] == true;
                        let result = &line["toolUseResult"];
                        builder.result(id, error, |action, input| {
                            finish(action, input, result, &block["content"]);
                        });
                    }
                    Some("text") => {
                        let text = block["text"].as_str().unwrap_or_default();
                        if !text.starts_with("[Request interrupted") {
                            texts.push(text.to_owned());
                        }
                    }
                    Some("image") => texts.push("[image]".into()),
                    _ => {}
                }
            }
            builder.text(true, texts.join("\n\n"), at);
        }
        Some("assistant") => {
            for block in content.as_array().into_iter().flatten() {
                match block["type"].as_str() {
                    Some("text") => {
                        let text = block["text"].as_str().unwrap_or_default();
                        builder.text(false, text.to_owned(), at.clone());
                    }
                    Some("tool_use") => {
                        let id = block["id"].as_str().unwrap_or_default();
                        let name = block["name"].as_str().unwrap_or_default();
                        builder.call(id, name, &block["input"], at.clone());
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

/// What the user typed. Claude Code wraps slash commands and its own notes
/// in tags whose names have a hyphen.
fn prompt(text: &str) -> Option<String> {
    let tag = text
        .strip_prefix('<')
        .and_then(|rest| rest.split_once('>'))
        .map(|(tag, _)| tag)
        .filter(|tag| tag.contains('-') && tag.chars().all(|c| c.is_ascii_lowercase() || c == '-'));
    match tag {
        None => Some(text.to_owned()),
        Some("command-name") => {
            let name = between(text, "<command-name>", "</command-name>")?;
            let args = between(text, "<command-args>", "</command-args>").unwrap_or_default();
            Some(format!("{name} {args}").trim().to_owned())
        }
        Some(_) => None,
    }
}

fn between<'a>(text: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = text.find(open)? + open.len();
    let end = text[start..].find(close)? + start;
    Some(text[start..end].trim())
}

fn finish(action: &mut Action, input: &Value, result: &Value, content: &Value) {
    match action.tool.as_str() {
        "edit" | "multiedit" | "write" => {
            let hunks = result["structuredPatch"].as_array().map(|hunks| {
                hunks
                    .iter()
                    .map(|h| Hunk {
                        old_start: h["oldStart"].as_u64().unwrap_or(0),
                        new_start: h["newStart"].as_u64().unwrap_or(0),
                        lines: h["lines"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter_map(|l| l.as_str().map(str::to_owned))
                            .collect(),
                    })
                    .collect::<Vec<_>>()
            });
            action.diff = match hunks {
                Some(hunks) if !hunks.is_empty() => diff(hunks),
                _ if result["type"] == "create" => created(
                    result["content"]
                        .as_str()
                        .or(input["content"].as_str())
                        .unwrap_or_default(),
                ),
                _ => None,
            };
        }
        "bash" if result.is_object() => {
            let out = [&result["stdout"], &result["stderr"]]
                .iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join("\n");
            action.output = output_tail(&out);
        }
        _ => {}
    }
    if action.status == ActionStatus::Error && action.output.is_none() {
        action.output = output_tail(&text_of(content));
    }
}

/// A tool result's content: a string or text blocks.
fn text_of(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|b| b["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::super::Entry;
    use super::*;
    use serde_json::json;

    fn parse(lines: &[Value]) -> Vec<Entry> {
        let mut builder = Builder::default();
        for line in lines {
            feed(&mut builder, line);
        }
        builder.entries
    }

    #[test]
    fn prompts_skip_claude_notes() {
        assert_eq!(prompt("fix the bug").as_deref(), Some("fix the bug"));
        assert_eq!(
            prompt("<command-name>/model</command-name>\n<command-args>opus</command-args>")
                .as_deref(),
            Some("/model opus")
        );
        assert_eq!(
            prompt("<local-command-stdout>ok</local-command-stdout>"),
            None
        );
        assert_eq!(
            prompt("<b>bold</b> idea").as_deref(),
            Some("<b>bold</b> idea")
        );
    }

    #[test]
    fn edits_carry_their_patch() {
        let entries = parse(&[
            json!({"type": "user", "cwd": "/p", "timestamp": "t0", "message": {"content": "rename it"}}),
            json!({"type": "assistant", "timestamp": "t1", "message": {"content": [
                {"type": "text", "text": "On it."},
                {"type": "tool_use", "id": "a", "name": "Edit", "input": {"file_path": "/p/src/x.rs"}}
            ]}}),
            json!({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "a", "content": "ok"}]},
                   "toolUseResult": {"structuredPatch": [{"oldStart": 3, "newStart": 3, "lines": ["-a", "+b", " c"]}]}}),
        ]);
        assert!(matches!(&entries[0], Entry::User { text, .. } if text == "rename it"));
        assert!(matches!(&entries[1], Entry::Assistant { text, .. } if text == "On it."));
        let Entry::Action(edit) = &entries[2] else {
            panic!()
        };
        assert_eq!(edit.target.as_deref(), Some("src/x.rs"));
        assert_eq!(edit.status, ActionStatus::Ok);
        let diff = edit.diff.as_ref().unwrap();
        assert_eq!((diff.added, diff.removed), (1, 1));
    }

    #[test]
    fn failed_commands_keep_their_output() {
        let entries = parse(&[
            json!({"type": "assistant", "message": {"content": [
                {"type": "tool_use", "id": "b", "name": "Bash", "input": {"command": "cargo test"}}
            ]}}),
            json!({"type": "user", "message": {"content": [
                {"type": "tool_result", "tool_use_id": "b", "is_error": true, "content": "Exit code 101\ntest failed"}
            ]}, "toolUseResult": "Error: Exit code 101"}),
        ]);
        let Entry::Action(bash) = &entries[0] else {
            panic!()
        };
        assert_eq!(bash.status, ActionStatus::Error);
        assert_eq!(bash.output.as_deref(), Some("Exit code 101\ntest failed"));
    }

    #[test]
    fn subagents_and_meta_messages_are_left_out() {
        let entries = parse(&[
            json!({"type": "user", "isSidechain": true, "message": {"content": "sub"}}),
            json!({"type": "user", "isMeta": true, "message": {"content": "caveat"}}),
            json!({"type": "assistant", "message": {"content": [{"type": "thinking", "thinking": "hm"}]}}),
        ]);
        assert!(entries.is_empty());
    }
}
