use alacritty_terminal::grid::Scroll;
use crossterm::event::Event;

use super::Server;
use crate::encode;

impl Server {
    pub(super) fn on_input(&mut self, event: Event) {
        match event {
            Event::Key(key) => {
                if let Some(window) = self.focused_window_mut() {
                    let bytes = encode::key(&key, *window.pane.term.mode());
                    if !bytes.is_empty() {
                        window.pane.term.scroll_display(Scroll::Bottom);
                        window.pane.write(bytes);
                    }
                }
            }
            Event::Paste(text) => {
                if let Some(window) = self.focused_window_mut() {
                    let bytes = encode::paste(&text, *window.pane.term.mode());
                    window.pane.write(bytes);
                }
            }
            Event::Resize(cols, rows) => self.resize(cols, rows),
            _ => {}
        }
        self.dirty = true;
    }

    fn focused_window_mut(&mut self) -> Option<&mut super::Window> {
        let id = self.model.focused()?;
        self.windows.get_mut(&id)
    }
}
