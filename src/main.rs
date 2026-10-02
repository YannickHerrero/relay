mod actions;
mod client;
mod config;
mod detect;
mod encode;
mod integration;
mod keymap;
mod keys;
mod layout;
mod model;
mod pane;
mod persist;
mod protocol;
mod server;
mod ui;

use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};

use protocol::{Hello, Request, Response};

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
    /// Show the server status.
    Status,
    /// List spaces.
    Spaces,
    /// List windows with their agent state.
    Windows,
    /// Focus the space of a project directory, creating it if needed.
    Open {
        path: String,
        /// Space name; defaults to the directory name.
        #[arg(long)]
        name: Option<String>,
    },
    /// Run a command in a new window.
    Run {
        #[arg(long)]
        space: Option<String>,
        /// Workspace 1 to 9.
        #[arg(long)]
        workspace: Option<usize>,
        #[arg(long)]
        float: bool,
        #[arg(required = true, trailing_var_arg = true)]
        command: Vec<String>,
    },
    /// Type text into a window.
    Send {
        window: String,
        text: String,
        /// Press Enter after the text.
        #[arg(long)]
        enter: bool,
    },
    /// Report an agent session id for resuming after a restart.
    ReportSession {
        #[arg(long)]
        agent: String,
        #[arg(long)]
        session: String,
        /// Defaults to $RELAY_WINDOW_ID.
        #[arg(long)]
        window: Option<String>,
    },
    /// Report an agent's lifecycle state: working, blocked or idle.
    ReportState {
        #[arg(long)]
        agent: String,
        #[arg(long)]
        state: String,
        #[arg(long, default_value_t = 0)]
        seq: u64,
        /// Defaults to $RELAY_WINDOW_ID.
        #[arg(long)]
        window: Option<String>,
    },
    /// Reload config.toml and keybindings.toml.
    Reload,
    /// Install an agent integration: claude or pi.
    Integration {
        #[command(subcommand)]
        action: IntegrationCmd,
    },
    /// Entry point for agent hooks; reads the hook payload on stdin.
    #[command(hide = true)]
    Hook { agent: String },
    /// Stop the server and every window in it.
    Stop,
}

#[derive(Subcommand)]
enum IntegrationCmd {
    Install { agent: String },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let request = match cli.command.unwrap_or(Cmd::Attach) {
        Cmd::Attach => {
            if std::env::var_os("RELAY").is_some() {
                anyhow::bail!("already inside relay");
            }
            return client::attach(connect_or_start()?);
        }
        Cmd::Server => return server::run(),
        Cmd::Status => Request::Status,
        Cmd::Spaces => Request::ListSpaces,
        Cmd::Windows => Request::ListWindows,
        Cmd::Open { path, name } => {
            let path = std::fs::canonicalize(&path).unwrap_or_else(|_| path.into());
            return print(send_request(
                Request::OpenSpace {
                    path: path.display().to_string(),
                    name,
                },
                true,
            )?);
        }
        Cmd::Run {
            space,
            workspace,
            float,
            command,
        } => {
            return print(send_request(
                Request::Run {
                    command: command.join(" "),
                    space,
                    workspace,
                    float,
                },
                true,
            )?);
        }
        Cmd::Send {
            window,
            text,
            enter,
        } => Request::SendText {
            window,
            text: if enter { format!("{text}\r") } else { text },
        },
        Cmd::ReportSession {
            agent,
            session,
            window,
        } => Request::ReportSession {
            window: own_window(window)?,
            agent,
            session,
        },
        Cmd::ReportState {
            agent,
            state,
            seq,
            window,
        } => Request::ReportState {
            window: own_window(window)?,
            agent,
            state,
            seq,
        },
        Cmd::Reload => Request::ReloadConfig,
        Cmd::Integration {
            action: IntegrationCmd::Install { agent },
        } => {
            println!("{}", integration::install(&agent)?);
            return Ok(());
        }
        Cmd::Hook { agent } => {
            // A hook must never fail the agent it runs in.
            let mut payload = String::new();
            let _ = std::io::Read::read_to_string(&mut std::io::stdin(), &mut payload);
            if agent == "claude"
                && let (Some(session), Ok(window)) = (
                    integration::claude_session(&payload),
                    std::env::var("RELAY_WINDOW_ID"),
                )
            {
                let _ = send_request(
                    Request::ReportSession {
                        window,
                        agent,
                        session,
                    },
                    false,
                );
            }
            return Ok(());
        }
        Cmd::Stop => Request::Stop,
    };
    print(send_request(request, false)?)
}

fn own_window(window: Option<String>) -> anyhow::Result<String> {
    window
        .or_else(|| std::env::var("RELAY_WINDOW_ID").ok())
        .ok_or_else(|| anyhow::anyhow!("not inside a relay window; pass --window"))
}

/// Sends one API request; `start` launches the server when none runs.
fn send_request(request: Request, start: bool) -> anyhow::Result<serde_json::Value> {
    let mut stream = if start {
        connect_or_start()?
    } else {
        UnixStream::connect(config::socket_path())
            .map_err(|_| anyhow::anyhow!("relay server is not running"))?
    };
    protocol::write_json(&mut stream, &Hello::Api(request))?;
    match protocol::read_json(&mut stream)? {
        Response::Ok(value) => Ok(value),
        Response::Error(e) => anyhow::bail!(e),
    }
}

fn print(value: serde_json::Value) -> anyhow::Result<()> {
    if !value.is_null() {
        println!("{}", serde_json::to_string_pretty(&value)?);
    }
    Ok(())
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
