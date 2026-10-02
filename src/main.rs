mod actions;
mod client;
mod config;
mod detect;
mod encode;
mod keymap;
mod keys;
mod layout;
mod model;
mod pane;
mod protocol;
mod server;
mod ui;

use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "relay",
    version,
    about = "Tiling terminal window manager for coding agents"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Cmd>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Attach to the server, starting it if needed (the default).
    Attach,
    /// Run the server in the foreground.
    Server,
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command.unwrap_or(Cmd::Attach) {
        Cmd::Attach => {
            if std::env::var_os("RELAY").is_some() {
                anyhow::bail!("already inside relay");
            }
            client::attach(connect_or_start()?)
        }
        Cmd::Server => server::run(),
    }
}

/// Connects to the server, starting it in the background first if needed.
fn connect_or_start() -> anyhow::Result<UnixStream> {
    let socket = config::socket_path();
    if let Ok(stream) = UnixStream::connect(&socket) {
        return Ok(stream);
    }
    let state = config::state_dir();
    std::fs::create_dir_all(&state)?;
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(state.join("server.log"))?;
    let mut command = Command::new(std::env::current_exe()?);
    command
        .arg("server")
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    // The server must outlive this terminal: own session, no controlling tty.
    unsafe {
        command.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    command.spawn()?;
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if let Ok(stream) = UnixStream::connect(&socket) {
            return Ok(stream);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    anyhow::bail!(
        "the server did not start, see {}",
        state.join("server.log").display()
    )
}
