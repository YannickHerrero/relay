//! Messages on the server socket. Each frame is a tag byte, a big-endian u32
//! length and the payload: JSON for messages, raw bytes for screen output.

use std::io::{self, Read, Write};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

const TAG_JSON: u8 = 0;
const TAG_BYTES: u8 = 1;
const MAX_FRAME: usize = 64 * 1024 * 1024;

pub enum Frame {
    Json(Vec<u8>),
    Bytes(Vec<u8>),
}

pub fn write_json(w: &mut impl Write, value: &impl Serialize) -> io::Result<()> {
    let payload = serde_json::to_vec(value)?;
    write_frame(w, TAG_JSON, &payload)
}

pub fn write_bytes(w: &mut impl Write, bytes: &[u8]) -> io::Result<()> {
    write_frame(w, TAG_BYTES, bytes)
}

fn write_frame(w: &mut impl Write, tag: u8, payload: &[u8]) -> io::Result<()> {
    let mut header = [0u8; 5];
    header[0] = tag;
    header[1..].copy_from_slice(&(payload.len() as u32).to_be_bytes());
    w.write_all(&header)?;
    w.write_all(payload)?;
    w.flush()
}

pub fn read_frame(r: &mut impl Read) -> io::Result<Frame> {
    let mut header = [0u8; 5];
    r.read_exact(&mut header)?;
    let len = u32::from_be_bytes(header[1..].try_into().unwrap()) as usize;
    if len > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "frame too large",
        ));
    }
    let mut payload = vec![0u8; len];
    r.read_exact(&mut payload)?;
    match header[0] {
        TAG_JSON => Ok(Frame::Json(payload)),
        TAG_BYTES => Ok(Frame::Bytes(payload)),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "unknown frame tag",
        )),
    }
}

pub fn read_json<T: DeserializeOwned>(r: &mut impl Read) -> io::Result<T> {
    match read_frame(r)? {
        Frame::Json(payload) => Ok(serde_json::from_slice(&payload)?),
        Frame::Bytes(_) => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "expected a message",
        )),
    }
}

/// First frame of every connection.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Hello {
    Attach {
        cols: u16,
        rows: u16,
        /// Where the first window opens when the server has none.
        #[serde(default)]
        cwd: Option<String>,
    },
    Api(Request),
    /// Streams `Update`s until the connection closes.
    Subscribe,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientMsg {
    Event(crossterm::event::Event),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerMsg {
    /// The client must leave; `reason` is shown after the screen is restored.
    Exit { reason: String },
}

/// Pushed to subscribers: the whole state when they connect, then again
/// whenever it changes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Update {
    State {
        spaces: Vec<serde_json::Value>,
        windows: Vec<serde_json::Value>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum Request {
    Status,
    ListSpaces,
    ListWindows,
    /// Focuses the space named after `path`, creating it there if needed.
    OpenSpace {
        path: String,
        name: Option<String>,
    },
    Run {
        command: String,
        #[serde(default)]
        space: Option<String>,
        #[serde(default)]
        workspace: Option<usize>,
        #[serde(default)]
        float: bool,
    },
    SendText {
        window: String,
        text: String,
    },
    /// Presses keys written as chords: `Enter`, `Esc`, `Down`, `Ctrl+C`.
    SendKeys {
        window: String,
        keys: Vec<String>,
    },
    ReportSession {
        window: String,
        agent: String,
        session: String,
    },
    ReportState {
        window: String,
        agent: String,
        state: String,
        #[serde(default)]
        seq: u64,
    },
    ReloadConfig,
    Stop,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Response {
    Ok(serde_json::Value),
    Error(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip() {
        let mut buf = Vec::new();
        write_json(
            &mut buf,
            &Hello::Attach {
                cols: 80,
                rows: 24,
                cwd: None,
            },
        )
        .unwrap();
        write_bytes(&mut buf, b"\x1b[H").unwrap();
        let mut r = buf.as_slice();
        assert!(matches!(
            read_json(&mut r).unwrap(),
            Hello::Attach {
                cols: 80,
                rows: 24,
                ..
            }
        ));
        assert!(matches!(read_frame(&mut r).unwrap(), Frame::Bytes(b) if b == b"\x1b[H"));
    }

    #[test]
    fn requests_use_a_method_tag() {
        let json = r#"{"api":{"method":"run","command":"ls"}}"#;
        let hello: Hello = serde_json::from_str(json).unwrap();
        assert!(matches!(
            hello,
            Hello::Api(Request::Run { float: false, .. })
        ));
    }

    #[test]
    fn updates_use_an_event_tag() {
        let update = Update::State {
            spaces: vec![],
            windows: vec![],
        };
        assert_eq!(
            serde_json::to_string(&update).unwrap(),
            r#"{"event":"state","spaces":[],"windows":[]}"#
        );
    }

    #[test]
    fn crossterm_events_serialize() {
        use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
        let msg = ClientMsg::Event(Event::Key(KeyEvent::new(
            KeyCode::Char('x'),
            KeyModifiers::CONTROL,
        )));
        let mut buf = Vec::new();
        write_json(&mut buf, &msg).unwrap();
        let back: ClientMsg = read_json(&mut buf.as_slice()).unwrap();
        assert!(matches!(back, ClientMsg::Event(Event::Key(k)) if k.code == KeyCode::Char('x')));
    }
}
