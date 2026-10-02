//! Clients that follow the state instead of drawing the UI.

use std::os::unix::net::UnixStream;
use std::sync::mpsc::{Sender, channel};

use super::Server;
use crate::protocol::{self, Update};

impl Server {
    pub(super) fn subscribe(&mut self, mut stream: UnixStream) {
        let (tx, rx) = channel::<Update>();
        std::thread::spawn(move || {
            for update in rx {
                if protocol::write_json(&mut stream, &update).is_err() {
                    break;
                }
            }
        });
        if tx.send(self.share_state()).is_ok() {
            self.subscribers.push(tx);
        }
    }

    /// Sends the state to subscribers and remote clients when it differs
    /// from what they have.
    pub(super) fn publish(&mut self) {
        if self.subscribers.is_empty() && self.remotes.is_empty() {
            self.published = None;
            return;
        }
        self.share_state();
    }

    /// The current state, after bringing every client up to date with it.
    pub(super) fn share_state(&mut self) -> Update {
        let update = self.state_update();
        if self.published.as_ref() != Some(&update) {
            // A client whose connection thread ended has disconnected.
            self.subscribers
                .retain(|tx: &Sender<Update>| tx.send(update.clone()).is_ok());
            self.remotes.retain(|_, tx| tx.send(update.clone()).is_ok());
            self.published = Some(update.clone());
        }
        update
    }

    fn state_update(&self) -> Update {
        Update::State {
            spaces: self.space_list(),
            windows: self.window_list(),
        }
    }
}
