//! The server owns every terminal and the whole UI. Clients only forward
//! their input and display the frames it sends.

mod actions;
mod agents;
mod api;
mod bar;
mod chrome;
mod input;
mod menu;
mod motion;
mod mouse;
mod overlay;
mod palette;
mod render;
mod session;
mod spaces;
mod whichkey;

use std::collections::HashMap;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::time::{Duration, Instant};

use ratatui::layout::Rect;

use crate::config::{self, Config};
use crate::detect::tracker::Tracker;
use crate::keymap::{KeybindingsFile, Keymap};
use crate::layout;
use crate::model::{Location, Model, Space, WindowId};
use crate::pane::{Pane, PaneEvent, Spawn};
use crate::protocol::{self, ClientMsg, Hello, Request, Response, ServerMsg};
use crate::ui::output::Output;

const FRAME: Duration = Duration::from_millis(8);
const BAR_HEIGHT: u16 = 1;

pub enum Event {
    Pane(PaneEvent),
    Attach {
        id: u64,
        stream: UnixStream,
        cols: u16,
        rows: u16,
        cwd: Option<PathBuf>,
    },
    Client(u64, ClientMsg),
    ClientGone(u64),
    Api(Request, Sender<Response>),
}

pub struct Window {
    pub pane: Pane,
    pub tracker: Tracker,
    /// A popup closes with its command and never tiles.
    pub popup: bool,
    /// Position while floating, relative to the screen.
    pub float_rect: Option<Rect>,
    /// Where the layout puts the window.
    pub rect: Rect,
    pub detect: agents::DetectState,
    pub slide: Option<motion::Slide>,
    /// Typed once the shell prints its first prompt, so it is not echoed
    /// before it.
    pub pending_input: Option<String>,
}

enum Out {
    Bytes(Vec<u8>),
    Msg(ServerMsg),
}

struct Client {
    id: u64,
    out: Sender<Out>,
    cols: u16,
    rows: u16,
    output: Output,
}

pub struct Server {
    config: Config,
    keymap: Keymap,
    model: Model,
    windows: HashMap<WindowId, Window>,
    next_window: WindowId,
    client: Option<Client>,
    tx: Sender<Event>,
    dirty: bool,
    quit: bool,
    size: (u16, u16),
    leader: Option<input::Leader>,
    mouse: mouse::MouseState,
    overlay: Option<overlay::ListOverlay>,
    menu: Option<menu::Menu>,
    /// Start of the shimmer cycle.
    epoch: Instant,
    /// Last state written to disk.
    saved: Option<crate::persist::State>,
}

pub fn run() -> anyhow::Result<()> {
    let socket = config::socket_path();
    if let Some(dir) = socket.parent() {
        std::fs::create_dir_all(dir)?;
    }
    if UnixStream::connect(&socket).is_ok() {
        anyhow::bail!("a relay server is already running on {}", socket.display());
    }
    let _ = std::fs::remove_file(&socket);
    let listener = UnixListener::bind(&socket)?;
    std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600))?;

    let (tx, rx) = channel();
    let accept_tx = tx.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let tx = accept_tx.clone();
            std::thread::spawn(move || serve_connection(stream, tx));
        }
    });

    let mut server = Server::new(tx);
    if let Some(state) = crate::persist::load(&crate::persist::path()) {
        server.restore(state);
    }
    server.main_loop(rx);
    let _ = std::fs::remove_file(&socket);
    Ok(())
}

fn serve_connection(mut stream: UnixStream, tx: Sender<Event>) {
    static NEXT_CLIENT: AtomicU64 = AtomicU64::new(1);
    let Ok(hello) = protocol::read_json::<Hello>(&mut stream) else {
        return;
    };
    match hello {
        Hello::Attach { cols, rows, cwd } => {
            let id = NEXT_CLIENT.fetch_add(1, Ordering::Relaxed);
            let Ok(writer) = stream.try_clone() else {
                return;
            };
            let _ = tx.send(Event::Attach {
                id,
                stream: writer,
                cols,
                rows,
                cwd: cwd.map(PathBuf::from),
            });
            while let Ok(msg) = protocol::read_json::<ClientMsg>(&mut stream) {
                if tx.send(Event::Client(id, msg)).is_err() {
                    return;
                }
            }
            let _ = tx.send(Event::ClientGone(id));
        }
        Hello::Api(request) => {
            let (reply_tx, reply_rx) = channel();
            if tx.send(Event::Api(request, reply_tx)).is_err() {
                return;
            }
            let response = reply_rx
                .recv_timeout(Duration::from_secs(10))
                .unwrap_or_else(|_| Response::Error("server did not answer".into()));
            let _ = protocol::write_json(&mut stream, &response);
        }
    }
}

impl Server {
    fn new(tx: Sender<Event>) -> Server {
        let config = Config::load().unwrap_or_else(|e| {
            eprintln!("relay: {e}");
            Config::default()
        });
        let keymap = load_keymap(&config);
        Server {
            model: Model::new(Space::new("main", config::home())),
            config,
            keymap,
            windows: HashMap::new(),
            next_window: 1,
            client: None,
            tx,
            dirty: true,
            quit: false,
            size: (80, 24),
            leader: None,
            mouse: Default::default(),
            overlay: None,
            menu: None,
            epoch: Instant::now(),
            saved: None,
        }
    }

    fn main_loop(&mut self, rx: Receiver<Event>) {
        let mut last_render = Instant::now();
        let mut minute = chrono::Local::now().format("%H:%M").to_string();
        let mut last_detect = Instant::now();
        let mut animation_due: Option<Instant> = None;
        let mut last_save = Instant::now();
        while !self.quit {
            let until_detect = agents::DETECT_INTERVAL.saturating_sub(last_detect.elapsed());
            let until_animation = animation_due
                .map(|due| due.saturating_duration_since(Instant::now()))
                .unwrap_or(until_detect);
            let timeout = if self.dirty {
                FRAME
                    .saturating_sub(last_render.elapsed())
                    .min(until_detect)
            } else {
                until_detect.min(until_animation)
            };
            match rx.recv_timeout(timeout) {
                Ok(event) => self.handle(event),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            while let Ok(event) = rx.try_recv() {
                self.handle(event);
            }
            if last_detect.elapsed() >= agents::DETECT_INTERVAL {
                last_detect = Instant::now();
                self.detect_agents(last_detect);
            }
            let now_minute = chrono::Local::now().format("%H:%M").to_string();
            if now_minute != minute {
                minute = now_minute;
                self.dirty = true;
            }
            if last_save.elapsed() >= session::SAVE_INTERVAL {
                last_save = Instant::now();
                self.save_state();
            }
            if animation_due.is_some_and(|due| Instant::now() >= due) {
                self.dirty = true;
            }
            if self.dirty && last_render.elapsed() >= FRAME {
                self.render();
                last_render = Instant::now();
                animation_due = self
                    .next_animation(last_render)
                    .map(|frame| last_render + frame);
            }
        }
        self.save_state();
        for window in self.windows.values_mut() {
            window.pane.kill();
        }
        if let Some(client) = self.client.take() {
            let _ = client.out.send(Out::Msg(ServerMsg::Exit {
                reason: "server stopped".into(),
            }));
        }
    }

    fn handle(&mut self, event: Event) {
        match event {
            Event::Pane(PaneEvent::Output(id, bytes)) => {
                if let Some(window) = self.windows.get_mut(&id) {
                    window.pane.feed(&bytes);
                    if let Some(input) = window.pending_input.take() {
                        window.pane.write(input);
                    }
                    let copies = std::mem::take(&mut window.pane.clipboard);
                    for text in copies {
                        self.copy_to_clipboard(&text);
                    }
                    self.dirty = true;
                }
            }
            Event::Pane(PaneEvent::Exited(id)) => self.close_window(id),
            Event::Attach {
                id,
                stream,
                cols,
                rows,
                cwd,
            } => self.attach(id, stream, cols, rows, cwd),
            Event::Client(id, ClientMsg::Event(event)) => {
                if self.client.as_ref().is_some_and(|c| c.id == id) {
                    self.on_input(event);
                }
            }
            Event::ClientGone(id) => {
                if self.client.as_ref().is_some_and(|c| c.id == id) {
                    self.client = None;
                }
            }
            Event::Api(request, reply) => {
                let response = match self.api(request) {
                    Ok(value) => Response::Ok(value),
                    Err(e) => Response::Error(e.to_string()),
                };
                let _ = reply.send(response);
                self.dirty = true;
            }
        }
    }

    fn attach(&mut self, id: u64, stream: UnixStream, cols: u16, rows: u16, cwd: Option<PathBuf>) {
        if let Some(old) = self.client.take() {
            let _ = old.out.send(Out::Msg(ServerMsg::Exit {
                reason: "another client attached".into(),
            }));
        }
        let (out, out_rx) = channel::<Out>();
        std::thread::spawn(move || {
            let mut stream = stream;
            for message in out_rx {
                let ok = match message {
                    Out::Bytes(bytes) => protocol::write_bytes(&mut stream, &bytes),
                    Out::Msg(msg) => {
                        let sent = protocol::write_json(&mut stream, &msg);
                        let _ = stream.flush();
                        let _ = stream.shutdown(std::net::Shutdown::Both);
                        sent
                    }
                };
                if ok.is_err() {
                    break;
                }
            }
        });
        self.client = Some(Client {
            id,
            out,
            cols,
            rows,
            output: Output::new(),
        });
        self.resize(cols, rows);
        if self.windows.is_empty() {
            let cwd = cwd.filter(|p| p.is_dir()).unwrap_or_else(config::home);
            self.model.space_mut().cwd = cwd.clone();
            self.spawn_shell(cwd, None);
        }
        self.dirty = true;
    }

    fn detach(&mut self) {
        if let Some(client) = self.client.take() {
            let _ = client.out.send(Out::Msg(ServerMsg::Exit {
                reason: "detached".into(),
            }));
        }
    }

    fn resize(&mut self, cols: u16, rows: u16) {
        self.size = (cols, rows);
        if let Some(client) = &mut self.client {
            client.cols = cols;
            client.rows = rows;
            client.output.invalidate();
        }
        self.relayout();
        for window in self.windows.values_mut() {
            window.slide = None;
        }
    }

    /// Area the windows of a workspace share.
    fn work_area(&self) -> Rect {
        let (cols, rows) = self.size;
        Rect::new(0, BAR_HEIGHT, cols, rows.saturating_sub(BAR_HEIGHT))
    }

    /// Computes every window's rectangle and resizes its terminal.
    fn relayout(&mut self) {
        let area = self.work_area();
        let mut targets = Vec::new();
        for space in &self.model.spaces {
            for ws in &space.workspaces {
                let rects = layout::fibonacci(area, ws.tiled.len(), &ws.ratios);
                targets.extend(ws.tiled.iter().copied().zip(rects));
                for id in &ws.floating {
                    if let Some(window) = self.windows.get_mut(id) {
                        let rect = *window
                            .float_rect
                            .get_or_insert_with(|| centered(area, 2, 3));
                        targets.push((*id, rect));
                    }
                }
                if let Some(id) = ws.fullscreen
                    && let Some(target) = targets.iter_mut().find(|(t, _)| *t == id)
                {
                    target.1 = area;
                }
            }
        }
        let now = Instant::now();
        let visible: Vec<WindowId> = self.model.workspace().windows().collect();
        let slides = self.slides();
        for (id, rect) in targets {
            let Some(window) = self.windows.get_mut(&id) else {
                continue;
            };
            if window.rect != rect && slides && visible.contains(&id) {
                window.slide = Some(motion::Slide {
                    from: motion::displayed(window.rect, window.slide, now),
                    start: now,
                });
            }
            window.rect = rect;
            let inner = inner(rect);
            window.pane.resize(inner.width, inner.height);
        }
        self.dirty = true;
    }

    fn pane_env(&self, id: WindowId) -> Vec<(String, String)> {
        let mut env = vec![
            ("RELAY".to_owned(), "1".to_owned()),
            ("RELAY_WINDOW_ID".to_owned(), format!("w{id}")),
            (
                "RELAY_SOCKET".to_owned(),
                config::socket_path().display().to_string(),
            ),
        ];
        if let Ok(exe) = std::env::current_exe() {
            env.push(("RELAY_BIN".to_owned(), exe.display().to_string()));
        }
        env
    }

    /// Opens a shell in a new tiled window of the current workspace, typing
    /// `command` into it when given.
    fn spawn_shell(&mut self, cwd: PathBuf, command: Option<&str>) -> Option<WindowId> {
        self.spawn_shell_at(self.here(), cwd, command, false)
    }

    fn spawn_shell_at(
        &mut self,
        at: Location,
        cwd: PathBuf,
        command: Option<&str>,
        floating: bool,
    ) -> Option<WindowId> {
        let spawn = Spawn {
            program: self.config.shell(),
            args: vec![],
            cwd,
            env: vec![],
        };
        let id = self.spawn_window(at, spawn, false, floating)?;
        if let (Some(command), Some(window)) = (command, self.windows.get_mut(&id)) {
            window.pending_input = Some(format!("{command}\r"));
        }
        Some(id)
    }

    fn spawn_window(
        &mut self,
        at: Location,
        mut spawn: Spawn,
        popup: bool,
        floating: bool,
    ) -> Option<WindowId> {
        let id = self.next_window;
        self.next_window += 1;
        spawn.env.extend(self.pane_env(id));
        let tx = self.tx.clone();
        let area = self.work_area();
        let pane = match Pane::spawn(
            id,
            spawn,
            area.width.saturating_sub(2),
            area.height.saturating_sub(2),
            move |e| {
                let _ = tx.send(Event::Pane(e));
            },
        ) {
            Ok(pane) => pane,
            Err(e) => {
                eprintln!("relay: cannot start window: {e}");
                return None;
            }
        };
        self.windows.insert(
            id,
            Window {
                pane,
                tracker: Tracker::default(),
                popup,
                float_rect: None,
                rect: area,
                detect: Default::default(),
                slide: None,
                pending_input: None,
            },
        );
        self.model.add(at, id, popup || floating);
        self.relayout();
        if self.slides()
            && let Some(window) = self.windows.get_mut(&id)
        {
            window.slide = Some(motion::Slide {
                from: motion::seed(window.rect),
                start: Instant::now(),
            });
        }
        Some(id)
    }

    fn close_window(&mut self, id: WindowId) {
        if let Some(mut window) = self.windows.remove(&id) {
            window.pane.kill();
        }
        self.model.remove(id);
        self.relayout();
    }

    fn here(&self) -> Location {
        Location {
            space: self.model.active,
            workspace: self.model.space().active,
        }
    }

    /// Bytes for the client terminal itself, outside any frame.
    fn send_raw(&mut self, bytes: Vec<u8>) {
        if let Some(client) = &self.client {
            let _ = client.out.send(Out::Bytes(bytes));
        }
    }

    fn render(&mut self) {
        self.dirty = false;
        let Some(client) = &self.client else {
            return;
        };
        let area = Rect::new(0, 0, client.cols, client.rows);
        let (frame, cursor) = render::frame(self, area);
        let client = self.client.as_mut().expect("client checked above");
        let bytes = client.output.encode(&frame, cursor);
        let _ = client.out.send(Out::Bytes(bytes));
    }
}

fn load_keymap(config: &Config) -> Keymap {
    let path = config::config_dir().join("keybindings.toml");
    let file: KeybindingsFile = match std::fs::read_to_string(&path) {
        Ok(text) => toml::from_str(&text).unwrap_or_else(|e| {
            eprintln!("relay: {}: {e}", path.display());
            KeybindingsFile::default()
        }),
        Err(_) => KeybindingsFile::default(),
    };
    let (keymap, errors) = Keymap::build(&file.keybindings, config.modifier, config.leader_chord());
    for error in errors {
        eprintln!("relay: keybindings.toml: {error}");
    }
    keymap
}

/// The terminal area inside a window's border.
pub fn inner(rect: Rect) -> Rect {
    Rect::new(
        rect.x + 1,
        rect.y + 1,
        rect.width.saturating_sub(2),
        rect.height.saturating_sub(2),
    )
}

/// A rectangle of `num/den` of `area`, centered.
pub fn centered(area: Rect, num: u16, den: u16) -> Rect {
    let w = area.width * num / den;
    let h = area.height * num / den;
    Rect::new(
        area.x + (area.width - w) / 2,
        area.y + (area.height - h) / 2,
        w,
        h,
    )
}
