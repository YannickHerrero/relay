//! Per-window agent state, combining process probes, screen detection and
//! hook reports with herdr's timing rules.

use std::time::{Duration, Instant};

use super::Agent;
use super::manifest::{AgentState, Detection};

/// Screen detection is ignored right after an agent appears: its first
/// frames are a splash screen, not a state.
const STARTUP_GRACE: Duration = Duration::from_secs(3);
/// A working agent must look idle this long, or this many times, before it
/// is published idle: spinners flicker between frames.
const IDLE_HOLD: Duration = Duration::from_millis(700);
const IDLE_CONFIRMATIONS: u32 = 3;
/// Probes that may miss the agent before it is considered gone.
const MISSED_PROBES: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Probe {
    /// The pane's shell is in the foreground again: whatever ran has exited.
    Shell,
    Agent(Agent),
    /// Something else is in the foreground.
    Other,
}

/// What the window shows: `Done` is idle after work nobody has looked at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Working,
    Blocked,
    Done,
    Idle,
    Unknown,
}

#[derive(Debug, Default)]
pub struct Tracker {
    agent: Option<Agent>,
    state: Option<AgentState>,
    seen: bool,
    session: Option<String>,
    acquired_at: Option<Instant>,
    pending_idle: Option<(Instant, u32)>,
    /// Pi reports its whole lifecycle; while it does, the screen is ignored.
    hook_state: Option<AgentState>,
    last_seq: u64,
    missed: u32,
    /// The session was restored and its agent has not started yet.
    restored: bool,
}

impl Tracker {
    pub fn agent(&self) -> Option<Agent> {
        self.agent
    }

    pub fn session(&self) -> Option<&str> {
        self.session.as_deref()
    }

    pub fn status(&self) -> Option<Status> {
        self.agent?;
        Some(match self.state? {
            AgentState::Working => Status::Working,
            AgentState::Blocked => Status::Blocked,
            AgentState::Idle if !self.seen => Status::Done,
            AgentState::Idle => Status::Idle,
            AgentState::Unknown => Status::Unknown,
        })
    }

    /// A working-to-idle change is waiting for confirmation.
    pub fn holding(&self) -> bool {
        self.pending_idle.is_some()
    }

    /// Whether screen detection has anything to decide right now.
    pub fn wants_screen(&self, now: Instant) -> bool {
        self.agent.is_some()
            && self.hook_state.is_none()
            && self.acquired_at.is_none_or(|t| now >= t + STARTUP_GRACE)
    }

    /// Restores a session reference saved before a restart.
    pub fn restore(&mut self, session: String) {
        self.session = Some(session);
        self.restored = true;
    }

    pub fn on_probe(&mut self, probe: Probe, now: Instant) {
        match probe {
            Probe::Agent(agent) => {
                self.missed = 0;
                self.restored = false;
                if self.agent != Some(agent) {
                    self.agent = Some(agent);
                    self.state = Some(AgentState::Unknown);
                    self.acquired_at = Some(now);
                    self.hook_state = None;
                    self.pending_idle = None;
                    self.seen = true;
                }
            }
            Probe::Shell => self.clear(),
            Probe::Other => {
                if self.agent.is_some() {
                    self.missed += 1;
                    if self.missed >= MISSED_PROBES {
                        self.clear();
                    }
                }
            }
        }
    }

    fn clear(&mut self) {
        let restored = self.restored.then(|| self.session.take()).flatten();
        *self = Tracker {
            last_seq: self.last_seq,
            restored: restored.is_some(),
            session: restored,
            ..Tracker::default()
        };
    }

    pub fn on_screen(&mut self, detection: &Detection, now: Instant, visible: bool) {
        if !self.wants_screen(now) {
            return;
        }
        if detection.skip {
            self.pending_idle = None;
            return;
        }
        let holding = self.state == Some(AgentState::Working)
            && detection.state == AgentState::Idle
            && !detection.visible_idle
            && !detection.visible_blocker;
        if !holding {
            self.pending_idle = None;
            self.set_state(detection.state, visible);
            return;
        }
        let (since, count) = self.pending_idle.get_or_insert((now, 0));
        *count += 1;
        if *count > IDLE_CONFIRMATIONS || now >= *since + IDLE_HOLD {
            self.pending_idle = None;
            self.set_state(AgentState::Idle, visible);
        }
    }

    /// Lifecycle state reported by an agent hook (pi). `seq` orders reports.
    pub fn on_hook_state(&mut self, agent: Agent, state: AgentState, seq: u64, visible: bool) {
        if seq != 0 && seq <= self.last_seq {
            return;
        }
        self.last_seq = seq;
        if self.agent != Some(agent) {
            self.agent = Some(agent);
            self.acquired_at = None;
            self.missed = 0;
        }
        self.hook_state = Some(state);
        self.pending_idle = None;
        self.set_state(state, visible);
    }

    pub fn on_hook_session(&mut self, agent: Agent, session: String) {
        if self.agent.is_none() {
            self.agent = Some(agent);
            self.state = Some(AgentState::Unknown);
            self.seen = true;
        }
        self.session = Some(session);
    }

    /// The user is looking at the window.
    pub fn mark_seen(&mut self) {
        self.seen = true;
    }

    fn set_state(&mut self, state: AgentState, visible: bool) {
        let finished = state == AgentState::Idle
            && matches!(self.state, Some(AgentState::Working | AgentState::Blocked));
        if finished {
            self.seen = visible;
        } else if state != AgentState::Idle {
            self.seen = true;
        }
        self.state = Some(state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detection(state: AgentState) -> Detection {
        Detection {
            state,
            rule: None,
            skip: false,
            visible_idle: false,
            visible_blocker: false,
        }
    }

    fn acquired(now: Instant) -> Tracker {
        let mut t = Tracker::default();
        t.on_probe(Probe::Agent(Agent::Claude), now - STARTUP_GRACE);
        t
    }

    #[test]
    fn screen_is_ignored_during_startup_grace() {
        let now = Instant::now();
        let mut t = Tracker::default();
        t.on_probe(Probe::Agent(Agent::Claude), now);
        t.on_screen(&detection(AgentState::Working), now, true);
        assert_eq!(t.status(), Some(Status::Unknown));
    }

    #[test]
    fn working_to_idle_is_held_then_published() {
        let now = Instant::now();
        let mut t = acquired(now);
        t.on_screen(&detection(AgentState::Working), now, true);
        t.on_screen(&detection(AgentState::Idle), now, true);
        assert_eq!(t.status(), Some(Status::Working));
        t.on_screen(&detection(AgentState::Idle), now + IDLE_HOLD, true);
        assert_eq!(t.status(), Some(Status::Idle));
    }

    #[test]
    fn finishing_unseen_is_done_until_seen() {
        let now = Instant::now();
        let mut t = acquired(now);
        t.on_screen(&detection(AgentState::Working), now, false);
        let mut idle = detection(AgentState::Idle);
        idle.visible_idle = true;
        t.on_screen(&idle, now, false);
        assert_eq!(t.status(), Some(Status::Done));
        t.mark_seen();
        assert_eq!(t.status(), Some(Status::Idle));
    }

    #[test]
    fn hook_state_overrides_screen() {
        let now = Instant::now();
        let mut t = acquired(now);
        t.on_hook_state(Agent::Pi, AgentState::Working, 5, true);
        t.on_screen(&detection(AgentState::Idle), now, true);
        assert_eq!(t.status(), Some(Status::Working));
        t.on_hook_state(Agent::Pi, AgentState::Idle, 4, true);
        assert_eq!(t.status(), Some(Status::Working));
    }

    #[test]
    fn shell_in_foreground_clears_the_agent() {
        let now = Instant::now();
        let mut t = acquired(now);
        t.on_probe(Probe::Shell, now);
        assert_eq!(t.status(), None);
    }

    #[test]
    fn restored_session_survives_until_its_agent_exits() {
        let now = Instant::now();
        let mut t = Tracker::default();
        t.restore("abc".into());
        t.on_probe(Probe::Shell, now);
        assert_eq!(t.session(), Some("abc"));
        t.on_probe(Probe::Agent(Agent::Claude), now);
        t.on_probe(Probe::Shell, now);
        assert_eq!(t.session(), None);
    }

    #[test]
    fn other_process_needs_several_misses() {
        let now = Instant::now();
        let mut t = acquired(now);
        t.on_probe(Probe::Other, now);
        assert!(t.agent().is_some());
        t.on_probe(Probe::Other, now);
        t.on_probe(Probe::Other, now);
        assert!(t.agent().is_none());
    }
}
