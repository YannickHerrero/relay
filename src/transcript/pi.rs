//! pi sessions: one JSON object per line, under
//! `~/.pi/agent/sessions/<directory>/<time>_<session>.jsonl`.

use std::path::PathBuf;

use serde_json::Value;

use super::{ActionStatus, Builder, created, diff, output_tail, unified};

pub fn sessions_dir() -> PathBuf {
    crate::integration::pi_dir().join("sessions")
}

pub(super) fn feed(builder: &mut Builder, line: &Value) {
    let at = line["timestamp"].as_str().map(str::to_owned);
    match line["type"].as_str() {
        Some("session") => {
            if let Some(cwd) = line["cwd"].as_str() {
                builder.cwd = Some(cwd.into());
            }
        }
        Some("message") => message(builder, &line["message"], at),
        _ => {}
    }
}

fn message(builder: &mut Builder, message: &Value, at: Option<String>) {
    let content = &message["content"];
    match message["role"].as_str() {
        Some("user") => builder.text(true, text_of(content, true), at),
        Some("assistant") => {
            for block in content.as_array().into_iter().flatten() {
                match block["type"].as_str() {
                    Some("text") => {
                        let text = block["text"].as_str().unwrap_or_default();
                        builder.text(false, text.to_owned(), at.clone());
                    }
                    Some("toolCall") => {
                        let id = block["id"].as_str().unwrap_or_default();
                        let name = block["name"].as_str().unwrap_or_default();
                        builder.call(id, name, &block["arguments"], at.clone());
                    }
                    _ => {}
                }
            }
        }
        Some("toolResult") => {
            let id = message["toolCallId"].as_str().unwrap_or_default();
            let error = message["isError"] == true;
            let output = text_of(content, false);
            builder.result(id, error, |action, input| {
                match action.tool.as_str() {
                    "edit" => {
                        let patch = message["details"]["patch"].as_str().unwrap_or_default();
                        action.diff = diff(unified(patch));
                    }
                    "write" => action.diff = created(input["content"].as_str().unwrap_or_default()),
                    "bash" => action.output = output_tail(&output),
                    _ => {}
                }
                if action.status == ActionStatus::Error && action.output.is_none() {
                    action.output = output_tail(&output);
                }
            });
        }
        _ => {}
    }
}

/// Text of a message: a string or blocks; `images` marks where images were.
fn text_of(content: &Value, images: bool) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|b| match b["type"].as_str() {
                Some("text") => b["text"].as_str().map(str::to_owned),
                Some("image") if images => Some("[image]".into()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n\n"),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::super::Entry;
    use super::*;
    use serde_json::json;

    #[test]
    fn calls_and_results_make_one_action() {
        let mut builder = Builder::default();
        for line in [
            json!({"type": "session", "cwd": "/p"}),
            json!({"type": "message", "timestamp": "t0", "message": {"role": "user", "content": [{"type": "text", "text": "hi"}]}}),
            json!({"type": "message", "message": {"role": "assistant", "content": [
                {"type": "thinking", "thinking": "..."},
                {"type": "toolCall", "id": "c1", "name": "edit", "arguments": {"path": "/p/a.rs"}}
            ]}}),
            json!({"type": "message", "message": {"role": "toolResult", "toolCallId": "c1", "toolName": "edit",
                "content": [{"type": "text", "text": "Successfully replaced 1 block(s)"}], "isError": false,
                "details": {"patch": "--- a.rs\n+++ a.rs\n@@ -1,2 +1,2 @@\n-x\n+y\n z\n"}}}),
        ] {
            feed(&mut builder, &line);
        }
        let entries = builder.entries;
        assert_eq!(entries.len(), 2);
        let Entry::Action(edit) = &entries[1] else {
            panic!()
        };
        assert_eq!(edit.target.as_deref(), Some("a.rs"));
        assert_eq!(
            edit.diff.as_ref().map(|d| (d.added, d.removed)),
            Some((1, 1))
        );
    }
}
