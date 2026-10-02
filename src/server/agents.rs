//! Runs agent detection over every window.

use std::time::{Duration, Instant};

use super::Server;
use crate::detect::process;
use crate::detect::tracker::Probe;
use crate::model::WindowId;

pub const DETECT_INTERVAL: Duration = Duration::from_millis(300);
/// Process probes run when the foreground group changes, and at least this
/// often.
const PROBE_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Debug, Clone)]
pub struct DetectState {
    last_probe: Option<Instant>,
    last_pgid: Option<u32>,
    scanned_seq: u64,
}

impl Default for DetectState {
    fn default() -> Self {
        DetectState {
            last_probe: None,
            last_pgid: None,
            scanned_seq: u64::MAX,
        }
    }
}

impl Server {
    pub(super) fn detect_agents(&mut self, now: Instant) {
        let visible: Vec<WindowId> = if self.client.is_some() {
            self.model.workspace().windows().collect()
        } else {
            Vec::new()
        };
        for (id, window) in &mut self.windows {
            let before = window.tracker.status();
            if let Some(shell) = window.pane.pid() {
                let pgid = process::foreground_pgid(shell);
                let due = window
                    .detect
                    .last_probe
                    .is_none_or(|t| now >= t + PROBE_INTERVAL);
                if pgid != window.detect.last_pgid || due {
                    window.detect.last_pgid = pgid;
                    window.detect.last_probe = Some(now);
                    let probe = match pgid {
                        Some(pgid) if pgid == shell => Probe::Shell,
                        Some(pgid) => match process::agent_in_group(pgid) {
                            Some(agent) => Probe::Agent(agent),
                            None => Probe::Other,
                        },
                        None => Probe::Other,
                    };
                    window.tracker.on_probe(probe, now);
                }
            }
            let changed = window.pane.seq != window.detect.scanned_seq;
            if let Some(agent) = window.tracker.agent()
                && window.tracker.wants_screen(now)
                && (changed || window.tracker.holding())
            {
                window.detect.scanned_seq = window.pane.seq;
                let detection = agent.manifest().detect(&window.pane.snapshot());
                window
                    .tracker
                    .on_screen(&detection, now, visible.contains(id));
            }
            if window.tracker.status() != before {
                self.dirty = true;
            }
        }
    }
}
