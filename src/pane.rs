//! One terminal: a PTY, the process in it, and its emulated screen.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex};

use alacritty_terminal::event::{Event as TermEvent, EventListener, WindowSize};
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::test::TermSize;
use alacritty_terminal::term::{self, Term};
use alacritty_terminal::vte::ansi::{self, NamedColor, Rgb};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};

use crate::detect::manifest::Snapshot;

pub enum PaneEvent {
    Output(u64, Vec<u8>),
    Exited(u64),
}

pub struct Spawn {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
}

/// Environment variables of the outer session that must not leak into panes:
/// they would make agents think they run nested in another agent or herdr.
const SCRUBBED_ENV: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CODEX_THREAD_ID",
    "TMUX",
    "TMUX_PANE",
];

#[derive(Clone, Default)]
pub struct Listener(Arc<Mutex<Vec<TermEvent>>>);

impl EventListener for Listener {
    fn send_event(&self, event: TermEvent) {
        self.0.lock().unwrap().push(event);
    }
}

pub struct Pane {
    pub term: Term<Listener>,
    parser: ansi::Processor,
    events: Listener,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    writer: Sender<Vec<u8>>,
    pub title: String,
    pub cols: u16,
    pub rows: u16,
    /// Clipboard writes the program asked for (OSC 52), for the client.
    pub clipboard: Vec<String>,
    pub bell: bool,
    /// Bumped on every output, so detection can skip unchanged screens.
    pub seq: u64,
}

impl Pane {
    pub fn spawn(
        id: u64,
        spawn: Spawn,
        cols: u16,
        rows: u16,
        notify: impl Fn(PaneEvent) + Send + 'static,
    ) -> anyhow::Result<Pane> {
        let (cols, rows) = (cols.max(2), rows.max(1));
        let pair = native_pty_system().openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let mut command = CommandBuilder::new(&spawn.program);
        command.args(&spawn.args);
        command.cwd(&spawn.cwd);
        for (key, _) in std::env::vars() {
            if SCRUBBED_ENV.contains(&key.as_str()) || key.starts_with("HERDR_") {
                command.env_remove(key);
            }
        }
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        for (key, value) in &spawn.env {
            command.env(key, value);
        }
        let child = pair.slave.spawn_command(command)?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader()?;
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => notify(PaneEvent::Output(id, buf[..n].to_vec())),
                }
            }
            notify(PaneEvent::Exited(id));
        });

        let mut writer = pair.master.take_writer()?;
        let (tx, rx) = channel::<Vec<u8>>();
        std::thread::spawn(move || {
            for bytes in rx {
                if writer
                    .write_all(&bytes)
                    .and_then(|_| writer.flush())
                    .is_err()
                {
                    break;
                }
            }
        });

        let events = Listener::default();
        let config = term::Config {
            kitty_keyboard: true,
            ..term::Config::default()
        };
        let term = Term::new(
            config,
            &TermSize::new(cols as usize, rows as usize),
            events.clone(),
        );
        Ok(Pane {
            term,
            parser: ansi::Processor::new(),
            events,
            master: pair.master,
            child,
            writer: tx,
            title: String::new(),
            cols,
            rows,
            clipboard: Vec::new(),
            bell: false,
            seq: 0,
        })
    }

    pub fn pid(&self) -> Option<u32> {
        self.child.process_id()
    }

    pub fn write(&self, bytes: impl Into<Vec<u8>>) {
        let _ = self.writer.send(bytes.into());
    }

    /// Feeds program output to the emulator and answers its queries.
    pub fn feed(&mut self, bytes: &[u8]) {
        self.seq += 1;
        self.parser.advance(&mut self.term, bytes);
        let events: Vec<TermEvent> = std::mem::take(&mut *self.events.0.lock().unwrap());
        for event in events {
            match event {
                TermEvent::PtyWrite(text) => self.write(text),
                TermEvent::Title(title) => self.title = title,
                TermEvent::ResetTitle => self.title.clear(),
                TermEvent::ClipboardStore(_, text) => self.clipboard.push(text),
                TermEvent::ColorRequest(index, format) => self.write(format(default_color(index))),
                TermEvent::TextAreaSizeRequest(format) => self.write(format(WindowSize {
                    num_lines: self.rows,
                    num_cols: self.cols,
                    cell_width: 8,
                    cell_height: 16,
                })),
                TermEvent::Bell => self.bell = true,
                _ => {}
            }
        }
    }

    pub fn resize(&mut self, cols: u16, rows: u16) {
        let (cols, rows) = (cols.max(2), rows.max(1));
        if (cols, rows) == (self.cols, self.rows) {
            return;
        }
        self.cols = cols;
        self.rows = rows;
        let _ = self.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
        self.term
            .resize(TermSize::new(cols as usize, rows as usize));
    }

    pub fn kill(&mut self) {
        let _ = self.child.kill();
    }

    /// The screen as the detector reads it: one viewport of rows ending at
    /// the last written row (or the cursor), trailing blanks trimmed.
    pub fn snapshot(&self) -> Snapshot {
        let grid = self.term.grid();
        let rows = grid.screen_lines() as i32;
        let cols = grid.columns();
        let line_text = |line: i32| -> String {
            let row = &grid[Line(line)];
            let mut text = String::new();
            for col in 0..cols {
                let cell = &row[Column(col)];
                if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
                    continue;
                }
                text.push(cell.c);
                if let Some(zw) = cell.zerowidth() {
                    text.extend(zw);
                }
            }
            text.trim_end().to_owned()
        };
        let end = if self.term.mode().contains(term::TermMode::ALT_SCREEN) {
            rows - 1
        } else {
            let last_written = (0..rows)
                .rev()
                .find(|l| !line_text(*l).is_empty())
                .unwrap_or(rows - 1);
            last_written.max(grid.cursor.point.line.0)
        };
        let oldest = -(grid.history_size() as i32);
        let start = (end + 1 - rows).max(oldest);
        let mut lines: Vec<String> = (start..=end).map(line_text).collect();
        while lines.last().is_some_and(|l| l.is_empty()) {
            lines.pop();
        }
        let mut text = lines.join("\n");
        if !text.is_empty() {
            text.push('\n');
        }
        Snapshot {
            text,
            osc_title: self.title.clone(),
            osc_progress: String::new(),
        }
    }
}

/// Answers for programs that ask the terminal its colors (OSC 4/10/11), so
/// they can pick a dark or light theme.
fn default_color(index: usize) -> Rgb {
    const ANSI: [(u8, u8, u8); 16] = [
        (0x45, 0x47, 0x5a),
        (0xf3, 0x8b, 0xa8),
        (0xa6, 0xe3, 0xa1),
        (0xf9, 0xe2, 0xaf),
        (0x89, 0xb4, 0xfa),
        (0xf5, 0xc2, 0xe7),
        (0x94, 0xe2, 0xd5),
        (0xba, 0xc2, 0xde),
        (0x58, 0x5b, 0x70),
        (0xf3, 0x8b, 0xa8),
        (0xa6, 0xe3, 0xa1),
        (0xf9, 0xe2, 0xaf),
        (0x89, 0xb4, 0xfa),
        (0xf5, 0xc2, 0xe7),
        (0x94, 0xe2, 0xd5),
        (0xa6, 0xad, 0xc8),
    ];
    let (r, g, b) = match index {
        i if i < 16 => ANSI[i],
        i if i == NamedColor::Background as usize => (0x1e, 0x1e, 0x2e),
        _ => (0xcd, 0xd6, 0xf4),
    };
    Rgb { r, g, b }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn spawn(program: &str, args: &[&str]) -> (Pane, mpsc::Receiver<PaneEvent>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let pane = Pane::spawn(
            1,
            Spawn {
                program: program.into(),
                args: args.iter().map(|a| (*a).to_owned()).collect(),
                cwd: std::env::temp_dir(),
                env: vec![],
            },
            40,
            10,
            move |e| {
                let _ = tx.lock().unwrap().send(e);
            },
        )
        .unwrap();
        (pane, rx)
    }

    fn run_to_exit(pane: &mut Pane, rx: &mpsc::Receiver<PaneEvent>) {
        loop {
            match rx.recv_timeout(Duration::from_secs(5)).expect("pane event") {
                PaneEvent::Output(_, bytes) => pane.feed(&bytes),
                PaneEvent::Exited(_) => break,
            }
        }
    }

    #[test]
    fn output_reaches_the_snapshot() {
        let (mut pane, rx) = spawn("/bin/sh", &["-c", "printf 'hello\\nworld'"]);
        run_to_exit(&mut pane, &rx);
        assert_eq!(pane.snapshot().text, "hello\nworld\n");
    }

    #[test]
    fn osc_title_is_captured() {
        let (mut pane, rx) = spawn("/bin/sh", &["-c", "printf '\\033]0;busy\\007'"]);
        run_to_exit(&mut pane, &rx);
        assert_eq!(pane.title, "busy");
    }

    #[test]
    fn resize_changes_the_terminal_size() {
        let (mut pane, rx) = spawn("/bin/sh", &["-c", "sleep 1; stty size"]);
        pane.resize(60, 20);
        run_to_exit(&mut pane, &rx);
        assert_eq!(pane.snapshot().text, "20 60\n");
    }
}
