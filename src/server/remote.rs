//! Remote clients over WebSocket. A connection thread does the handshake and
//! forwards messages; the main loop checks the hello and runs commands.

use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::fs::OpenOptionsExt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Sender, TryRecvError, channel};
use std::time::Duration;

use anyhow::bail;
use serde_json::{Value, json};
use tungstenite::{Message, WebSocket};

use super::{Event, Server};
use crate::config;
use crate::model::WindowId;
use crate::protocol::{Command, REMOTE_VERSION, RemoteHello, Request, Response, Update};

const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a connection waits for a message before writing what the server
/// queued for it.
const POLL: Duration = Duration::from_millis(50);

/// A remote client that passed its hello.
pub struct Remote {
    pub out: Sender<Update>,
    /// The window whose conversation it follows.
    pub viewing: Option<WindowId>,
}

pub struct Hello {
    pub id: u64,
    pub hello: RemoteHello,
    pub origin: Option<String>,
    pub out: Sender<Update>,
}

/// Starts listening when `[remote] listen` is set.
pub(super) fn start(server: &mut Server) {
    let address = server.config.remote.listen.clone();
    if address.is_empty() {
        return;
    }
    let token = match load_token() {
        Ok(token) => token,
        Err(e) => {
            eprintln!("relay: remote access is off, cannot read its token: {e}");
            return;
        }
    };
    let listener = match TcpListener::bind(&address) {
        Ok(listener) => listener,
        Err(e) => {
            eprintln!("relay: remote access is off, cannot listen on {address}: {e}");
            return;
        }
    };
    server.remote_token = Some(token);
    let tx = server.tx.clone();
    std::thread::spawn(move || {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        for stream in listener.incoming().flatten() {
            let tx = tx.clone();
            let id = NEXT.fetch_add(1, Ordering::Relaxed);
            std::thread::spawn(move || serve(stream, id, tx));
        }
    });
}

// The handshake callback's error type is tungstenite's.
#[allow(clippy::result_large_err)]
fn serve(stream: TcpStream, id: u64, tx: Sender<Event>) {
    if stream.set_read_timeout(Some(HELLO_TIMEOUT)).is_err() {
        return;
    }
    let mut origin = None;
    let handshake = tungstenite::accept_hdr(
        stream,
        |request: &tungstenite::handshake::server::Request, response| {
            origin = request
                .headers()
                .get("origin")
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            Ok(response)
        },
    );
    let Ok(mut ws) = handshake else {
        return;
    };
    let hello = match ws.read() {
        Ok(Message::Text(text)) => serde_json::from_str::<RemoteHello>(&text),
        _ => return,
    };
    let Ok(hello) = hello else {
        let _ = send(&mut ws, &closed("the first message must be a hello"));
        let _ = ws.close(None);
        let _ = ws.flush();
        return;
    };
    let (out, rx) = channel();
    let hello = Hello {
        id,
        hello,
        origin,
        out,
    };
    if tx.send(Event::RemoteHello(hello)).is_err()
        || ws.get_ref().set_read_timeout(Some(POLL)).is_err()
    {
        return;
    }
    'connection: loop {
        match ws.read() {
            Ok(Message::Text(text)) => match serde_json::from_str::<Command>(&text) {
                Ok(command) => {
                    if tx.send(Event::Remote(id, command)).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let reply = Update::Reply {
                        id: 0,
                        result: Response::Error(format!("not a command: {e}")),
                    };
                    if send(&mut ws, &reply).is_err() {
                        break;
                    }
                }
            },
            Ok(Message::Close(_)) => {
                // Sends the close reply tungstenite queued.
                let _ = ws.flush();
                break;
            }
            Ok(_) => {}
            Err(tungstenite::Error::Io(e))
                if matches!(
                    e.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) => {}
            Err(_) => break,
        }
        loop {
            match rx.try_recv() {
                Ok(update) => {
                    let last = matches!(update, Update::Closed { .. });
                    if send(&mut ws, &update).is_err() {
                        break 'connection;
                    }
                    if last {
                        let _ = ws.close(None);
                        let _ = ws.flush();
                        break 'connection;
                    }
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    let _ = ws.close(None);
                    let _ = ws.flush();
                    break 'connection;
                }
            }
        }
    }
    let _ = tx.send(Event::RemoteGone(id));
}

fn send(ws: &mut WebSocket<TcpStream>, update: &Update) -> tungstenite::Result<()> {
    let text = serde_json::to_string(update).expect("updates serialize");
    ws.send(Message::text(text))
}

fn closed(reason: &str) -> Update {
    Update::Closed {
        reason: reason.into(),
    }
}

/// Requests a remote client may make: no hooks, pairing or server control.
fn allowed(request: &Request) -> bool {
    matches!(
        request,
        Request::Status
            | Request::ListSpaces
            | Request::ListWindows
            | Request::OpenSpace { .. }
            | Request::Run { .. }
            | Request::SendText { .. }
            | Request::SendKeys { .. }
            | Request::View { .. }
            | Request::Transcript { .. }
    )
}

impl Server {
    pub(super) fn remote_hello(&mut self, hello: Hello) {
        let Hello {
            id,
            hello,
            origin,
            out,
        } = hello;
        let refusal = if hello.v != REMOTE_VERSION {
            Some(format!(
                "this relay speaks version {REMOTE_VERSION} of the protocol, not {}",
                hello.v
            ))
        } else if origin
            .as_ref()
            .is_some_and(|o| !self.config.remote.origins.contains(o))
        {
            Some("origin not allowed; add it to [remote] origins".into())
        } else if !self
            .remote_token
            .as_deref()
            .is_some_and(|t| same_secret(t, &hello.token))
        {
            Some("wrong token".into())
        } else {
            None
        };
        if let Some(reason) = refusal {
            let _ = out.send(closed(&reason));
            return;
        }
        let state = self.share_state();
        if out.send(state).is_ok() {
            self.remotes.insert(id, Remote { out, viewing: None });
        }
    }

    pub(super) fn remote_command(&mut self, id: u64, command: Command) {
        if !self.remotes.contains_key(&id) {
            return;
        }
        let result = if let Request::View { window } = &command.request {
            match self.view(id, window.as_deref()) {
                Ok(value) => Response::Ok(value),
                Err(e) => Response::Error(e.to_string()),
            }
        } else if allowed(&command.request) {
            match self.api(command.request) {
                Ok(value) => Response::Ok(value),
                Err(e) => Response::Error(e.to_string()),
            }
        } else {
            Response::Error("not available to remote clients".into())
        };
        if let Some(remote) = self.remotes.get(&id) {
            let _ = remote.out.send(Update::Reply {
                id: command.id,
                result,
            });
        }
        self.dirty = true;
    }

    pub(super) fn remote_pairing(&mut self, revoke: bool) -> anyhow::Result<Value> {
        let remote = &self.config.remote;
        if self.remote_token.is_none() {
            bail!(
                "remote access is off; set [remote] listen in config.toml and restart the server"
            );
        }
        if remote.url.is_empty() {
            bail!("set [remote] url to the address phones reach, such as wss://mac.example.ts.net");
        }
        if revoke {
            let token = new_token()?;
            save_token(&token)?;
            self.remote_token = Some(token);
            for (_, remote) in self.remotes.drain() {
                let _ = remote.out.send(closed("token revoked"));
            }
        }
        let name = if remote.name.is_empty() {
            host_name()
        } else {
            remote.name.clone()
        };
        Ok(json!({
            "name": name,
            "url": remote.url,
            "token": self.remote_token,
        }))
    }
}

/// Compares in constant time, so timing does not reveal the token.
fn same_secret(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0, |acc, (x, y)| acc | (x ^ y))
            == 0
}

fn token_path() -> std::path::PathBuf {
    config::state_dir().join("remote-token")
}

fn load_token() -> io::Result<String> {
    match std::fs::read_to_string(token_path()) {
        Ok(token) if !token.trim().is_empty() => Ok(token.trim().to_owned()),
        Ok(_) => create_token(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => create_token(),
        Err(e) => Err(e),
    }
}

fn create_token() -> io::Result<String> {
    let token = new_token()?;
    save_token(&token)?;
    Ok(token)
}

fn new_token() -> io::Result<String> {
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn save_token(token: &str) -> io::Result<()> {
    std::fs::create_dir_all(config::state_dir())?;
    let path = token_path();
    let _ = std::fs::remove_file(&path);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    writeln!(file, "{token}")
}

fn host_name() -> String {
    let mut buf = [0u8; 256];
    let ok = unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) } == 0;
    let end = buf.iter().position(|b| *b == 0).unwrap_or(buf.len());
    let name = String::from_utf8_lossy(&buf[..end]);
    let name = name.trim_end_matches(".local");
    if ok && !name.is_empty() {
        name.to_owned()
    } else {
        "relay".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_compare_by_value() {
        assert!(same_secret("abc", "abc"));
        assert!(!same_secret("abc", "abd"));
        assert!(!same_secret("abc", "abcd"));
    }

    #[test]
    fn tokens_are_long_and_random() {
        let (a, b) = (new_token().unwrap(), new_token().unwrap());
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
    }

    #[test]
    fn remote_clients_cannot_control_the_server() {
        assert!(allowed(&Request::ListWindows));
        assert!(!allowed(&Request::Stop));
        assert!(!allowed(&Request::RemotePairing { revoke: true }));
    }
}
