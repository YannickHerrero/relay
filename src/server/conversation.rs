//! Agent conversations for remote clients: follows each agent's session file
//! and sends the window a client views as it changes.

use anyhow::{Context, bail};
use serde_json::{Value, json};

use super::{Event, Server};
use crate::detect::Agent;
use crate::detect::tracker::Status;
use crate::model::WindowId;
use crate::protocol::Update;
use crate::transcript::{self, Change, Entry, Watcher};

/// Entries a client gets when it starts viewing a window.
const VIEW_LAST: usize = 100;
const MAX_PAGE: usize = 500;
const PREVIEW_CHARS: usize = 200;

pub struct Followed {
    agent: Agent,
    session: String,
    entries: Vec<Entry>,
    _watcher: Watcher,
}

/// When the window's agent status last changed.
pub struct StatusSince {
    status: Option<Status>,
    since: String,
}

impl StatusSince {
    pub fn new() -> StatusSince {
        StatusSince {
            status: None,
            since: now(),
        }
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn window_id(id: WindowId) -> String {
    format!("w{id}")
}

impl Server {
    /// Follows the session of every agent that reported one, and notes
    /// status changes.
    pub(super) fn follow_conversations(&mut self) {
        let mut restarted = Vec::new();
        for (&id, window) in &mut self.windows {
            let status = window.tracker.status();
            if status != window.status_since.status {
                window.status_since = StatusSince {
                    status,
                    since: now(),
                };
            }
            let want = window
                .tracker
                .agent()
                .zip(window.tracker.session().map(str::to_owned));
            let have = window
                .conversation
                .as_ref()
                .map(|c| (c.agent, c.session.clone()));
            if want == have {
                continue;
            }
            window.conversation = want.map(|(agent, session)| {
                let tx = self.tx.clone();
                let followed = session.clone();
                let watcher = transcript::watch(agent, session.clone(), move |change| {
                    let session = followed.clone();
                    tx.send(Event::Transcript {
                        window: id,
                        session,
                        change,
                    })
                    .is_ok()
                });
                Followed {
                    agent,
                    session,
                    entries: Vec::new(),
                    _watcher: watcher,
                }
            });
            restarted.push(id);
        }
        for id in restarted {
            self.send_to_viewers(
                id,
                Change {
                    from: 0,
                    entries: Vec::new(),
                },
            );
        }
    }

    pub(super) fn on_transcript(&mut self, id: WindowId, session: String, change: Change) {
        let Some(followed) = self
            .windows
            .get_mut(&id)
            .and_then(|w| w.conversation.as_mut())
            .filter(|c| c.session == session)
        else {
            return;
        };
        transcript::apply(&mut followed.entries, change.clone());
        let len = followed.entries.len();
        // A first read sends the whole file; viewers only need its end.
        let change = if len - change.from > VIEW_LAST {
            let from = len - VIEW_LAST;
            Change {
                from,
                entries: followed.entries[from..].to_vec(),
            }
        } else {
            change
        };
        self.send_to_viewers(id, change);
        self.dirty = true;
    }

    fn send_to_viewers(&self, id: WindowId, change: Change) {
        for remote in self.remotes.values() {
            if remote.viewing == Some(id) {
                let _ = remote.out.send(Update::Transcript {
                    window: window_id(id),
                    from: change.from,
                    entries: change.entries.clone(),
                });
            }
        }
    }

    /// A remote client starts viewing a window, or stops with None.
    pub(super) fn view(&mut self, remote: u64, window: Option<&str>) -> anyhow::Result<Value> {
        let id = window.map(super::api::parse_window).transpose()?;
        let entries = match id {
            Some(id) => {
                let window = self
                    .windows
                    .get_mut(&id)
                    .with_context(|| format!("no window w{id}"))?;
                window.tracker.mark_seen();
                window
                    .conversation
                    .as_ref()
                    .map(|c| c.entries.as_slice())
                    .unwrap_or_default()
            }
            None => &[],
        };
        let from = entries.len().saturating_sub(VIEW_LAST);
        let update = id.map(|id| Update::Transcript {
            window: window_id(id),
            from,
            entries: entries[from..].to_vec(),
        });
        let total = entries.len();
        let client = self
            .remotes
            .get_mut(&remote)
            .context("not a remote client")?;
        client.viewing = id;
        if let Some(update) = update {
            let _ = client.out.send(update);
        }
        self.dirty = true;
        Ok(json!({ "total": total }))
    }

    /// Entries before `before`, for scrolling back.
    pub(super) fn transcript_page(
        &self,
        window: &str,
        before: Option<usize>,
        limit: Option<usize>,
    ) -> anyhow::Result<Value> {
        let id = super::api::parse_window(window)?;
        let window = self
            .windows
            .get(&id)
            .with_context(|| format!("no window {window}"))?;
        let Some(followed) = &window.conversation else {
            bail!(
                "no conversation in {}: no agent with a known session",
                window_id(id)
            );
        };
        let total = followed.entries.len();
        let end = before.unwrap_or(total).min(total);
        let from = end.saturating_sub(limit.unwrap_or(VIEW_LAST).min(MAX_PAGE));
        Ok(json!({
            "from": from,
            "total": total,
            "entries": followed.entries[from..end],
        }))
    }

    /// Windows a remote client is looking at.
    pub(super) fn viewed(&self) -> Vec<WindowId> {
        self.remotes.values().filter_map(|r| r.viewing).collect()
    }

    /// Conversation fields of a window in the state.
    pub(super) fn conversation_fields(&self, id: WindowId) -> Value {
        let Some(window) = self.windows.get(&id) else {
            return json!({});
        };
        let entries = window
            .conversation
            .as_ref()
            .map(|c| c.entries.as_slice())
            .unwrap_or_default();
        let last_message = entries.iter().rev().find_map(|e| match e {
            Entry::User { text, at } => Some(("user", text, at)),
            Entry::Assistant { text, at } => Some(("assistant", text, at)),
            Entry::Action(_) => None,
        });
        json!({
            "state_since": window.status_since.since,
            "last_activity": entries.last().and_then(Entry::at),
            "last_message": last_message.map(|(role, text, at)| json!({
                "role": role,
                "text": preview(text),
                "at": at,
            })),
        })
    }
}

/// The start of a message on one line.
fn preview(text: &str) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    match line.char_indices().nth(PREVIEW_CHARS) {
        Some((end, _)) => format!("{}…", &line[..end]),
        None => line,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previews_fit_on_one_line() {
        assert_eq!(preview("Done.\n\n- tests   pass"), "Done. - tests pass");
        let long = "x".repeat(300);
        assert_eq!(preview(&long).chars().count(), PREVIEW_CHARS + 1);
    }
}
