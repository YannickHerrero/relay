//! The attached terminal: forwards input to the server, prints its frames.

use std::io::{self, Write};
use std::os::unix::net::UnixStream;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crossterm::event::{
    self, DisableBracketedPaste, DisableFocusChange, DisableMouseCapture, EnableBracketedPaste,
    EnableFocusChange, EnableMouseCapture, KeyboardEnhancementFlags, PopKeyboardEnhancementFlags,
    PushKeyboardEnhancementFlags,
};
use crossterm::terminal::{self, EnterAlternateScreen, LeaveAlternateScreen};
use crossterm::{cursor, execute};

use crate::protocol::{self, ClientMsg, Frame, Hello, ServerMsg};

pub fn attach(stream: UnixStream) -> anyhow::Result<()> {
    let (cols, rows) = terminal::size()?;
    let mut writer = stream.try_clone()?;
    let cwd = std::env::current_dir()
        .ok()
        .map(|p| p.display().to_string());
    protocol::write_json(&mut writer, &Hello::Attach { cols, rows, cwd })?;

    let _guard = TerminalGuard::enter()?;
    let done = Arc::new(AtomicBool::new(false));
    let reader_done = done.clone();
    let mut reader = stream;
    let output = std::thread::spawn(move || -> String {
        let mut stdout = io::stdout();
        let reason = loop {
            match protocol::read_frame(&mut reader) {
                Ok(Frame::Bytes(bytes)) => {
                    let _ = stdout.write_all(&bytes);
                    let _ = stdout.flush();
                }
                Ok(Frame::Json(payload)) => match serde_json::from_slice(&payload) {
                    Ok(ServerMsg::Exit { reason }) => break reason,
                    Err(_) => continue,
                },
                Err(_) => break "connection to the server lost".into(),
            }
        };
        reader_done.store(true, Ordering::Relaxed);
        reason
    });

    while !done.load(Ordering::Relaxed) {
        if !event::poll(Duration::from_millis(50))? {
            continue;
        }
        let event = event::read()?;
        if protocol::write_json(&mut writer, &ClientMsg::Event(event)).is_err() {
            break;
        }
    }
    let reason = output.join().unwrap_or_default();
    drop(_guard);
    println!("[relay: {reason}]");
    Ok(())
}

struct TerminalGuard {
    enhanced: bool,
}

impl TerminalGuard {
    fn enter() -> io::Result<TerminalGuard> {
        terminal::enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(
            stdout,
            EnterAlternateScreen,
            EnableMouseCapture,
            EnableBracketedPaste,
            EnableFocusChange
        )?;
        let enhanced = terminal::supports_keyboard_enhancement().unwrap_or(false);
        if enhanced {
            execute!(
                stdout,
                PushKeyboardEnhancementFlags(KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES)
            )?;
        }
        Ok(TerminalGuard { enhanced })
    }
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let mut stdout = io::stdout();
        if self.enhanced {
            let _ = execute!(stdout, PopKeyboardEnhancementFlags);
        }
        let _ = execute!(
            stdout,
            DisableFocusChange,
            DisableBracketedPaste,
            DisableMouseCapture,
            LeaveAlternateScreen,
            cursor::SetCursorStyle::DefaultUserShape,
            cursor::Show
        );
        let _ = terminal::disable_raw_mode();
    }
}
