//! Web Push to remote clients when an agent needs them and nobody is looking.

use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::Sender;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Value, json};
use web_push_native::WebPushBuilder;
use web_push_native::jwt_simple::algorithms::ES256KeyPair;
use web_push_native::jwt_simple::prelude::ECDSAP256PublicKeyLike;

use super::{Event, Server};
use crate::config;
use crate::detect::tracker::Status;
use crate::model::WindowId;

pub struct Push {
    key: Arc<ES256KeyPair>,
    /// Browsers' `PushSubscription`s as they sent them.
    subscriptions: Vec<Value>,
}

impl Push {
    pub fn load() -> io::Result<Push> {
        let key = match std::fs::read_to_string(key_path()) {
            Ok(text) => URL_SAFE_NO_PAD
                .decode(text.trim())
                .ok()
                .and_then(|raw| ES256KeyPair::from_bytes(&raw).ok())
                .ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("{} is not a VAPID key", key_path().display()),
                    )
                })?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let key = ES256KeyPair::generate();
                write_private(&key_path(), &URL_SAFE_NO_PAD.encode(key.to_bytes()))?;
                key
            }
            Err(e) => return Err(e),
        };
        let subscriptions = std::fs::read_to_string(subscriptions_path())
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Ok(Push {
            key: Arc::new(key),
            subscriptions,
        })
    }

    /// The application server key browsers subscribe with.
    pub fn public_key(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.key.public_key().public_key().to_bytes_uncompressed())
    }

    pub fn subscribe(&mut self, subscription: Value) -> anyhow::Result<()> {
        serde_json::from_value::<WebPushBuilder>(subscription.clone())
            .map_err(|e| anyhow::anyhow!("not a push subscription: {e}"))?;
        let endpoint = subscription["endpoint"].clone();
        self.subscriptions.retain(|s| s["endpoint"] != endpoint);
        self.subscriptions.push(subscription);
        self.save()
    }

    pub fn unsubscribe(&mut self, endpoint: &str) -> anyhow::Result<()> {
        self.subscriptions.retain(|s| s["endpoint"] != endpoint);
        self.save()
    }

    fn save(&self) -> anyhow::Result<()> {
        write_private(
            &subscriptions_path(),
            &serde_json::to_string(&self.subscriptions)?,
        )?;
        Ok(())
    }

    /// Sends `payload` to every subscription on another thread; push
    /// services answer 404 or 410 for subscriptions that are gone.
    fn send(&self, payload: Value, contact: String, tx: Sender<Event>) {
        let key = self.key.clone();
        let subscriptions = self.subscriptions.clone();
        std::thread::spawn(move || {
            let body = payload.to_string();
            for subscription in subscriptions {
                let request = match request(&subscription, &key, &contact, &body) {
                    Ok(request) => request,
                    Err(e) => {
                        eprintln!("relay: cannot build a push message: {e}");
                        continue;
                    }
                };
                match ureq::run(request) {
                    Ok(_) => {}
                    Err(ureq::Error::StatusCode(404 | 410)) => {
                        let endpoint = subscription["endpoint"].as_str().unwrap_or_default();
                        let _ = tx.send(Event::PushGone(endpoint.to_owned()));
                    }
                    Err(e) => eprintln!("relay: push failed: {e}"),
                }
            }
        });
    }
}

/// The encrypted, signed message for one subscription.
fn request(
    subscription: &Value,
    key: &ES256KeyPair,
    contact: &str,
    body: &str,
) -> anyhow::Result<http::Request<Vec<u8>>> {
    let builder = serde_json::from_value::<WebPushBuilder>(subscription.clone())?;
    Ok(builder.with_vapid(key, contact).build(body.as_bytes())?)
}

fn key_path() -> PathBuf {
    config::state_dir().join("remote-vapid")
}

fn subscriptions_path() -> PathBuf {
    config::state_dir().join("push-subscriptions.json")
}

fn write_private(path: &PathBuf, text: &str) -> io::Result<()> {
    let tmp = path.with_extension("tmp");
    let _ = std::fs::remove_file(&tmp);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&tmp)?;
    writeln!(file, "{text}")?;
    std::fs::rename(tmp, path)
}

impl Server {
    /// Tells subscribed devices that agents started waiting or finished.
    pub(super) fn notify(&self, changes: &[(WindowId, Status)]) {
        let Some(push) = &self.push else {
            return;
        };
        if push.subscriptions.is_empty() {
            return;
        }
        let machine = self.config.remote.url.clone();
        // Apple wants a contact; the web app's address is the best we have.
        let contact = self
            .config
            .remote
            .origins
            .first()
            .cloned()
            .unwrap_or_else(|| "mailto:relay@localhost".into());
        for &(id, status) in changes {
            let Some(window) = self.windows.get(&id) else {
                continue;
            };
            let agent = window.tracker.agent().map_or("agent", |a| a.name());
            let title = match status {
                Status::Blocked => format!("{agent} needs you"),
                _ => format!("{agent} is done"),
            };
            let space = self
                .model
                .locate(id)
                .map(|at| self.model.spaces[at.space].name.clone())
                .unwrap_or_default();
            let body = format!("{} · {space}", super::chrome::title(window));
            let window = format!("w{id}");
            let payload = json!({
                "title": title,
                "body": body,
                "window": window,
                "machine": machine,
                "tag": format!("{machine} {window}"),
            });
            push.send(payload, contact.clone(), self.tx.clone());
        }
    }

    pub(super) fn push_gone(&mut self, endpoint: &str) {
        if let Some(push) = &mut self.push {
            let _ = push.unsubscribe(endpoint);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use web_push_native::p256::SecretKey;
    use web_push_native::p256::elliptic_curve::sec1::ToEncodedPoint;

    #[test]
    fn messages_decrypt_with_the_subscription_keys() {
        let secret =
            SecretKey::random(&mut web_push_native::p256::elliptic_curve::rand_core::OsRng);
        let auth = [7u8; 16];
        let subscription = json!({
            "endpoint": "https://push.example/abc",
            "keys": {
                "p256dh": URL_SAFE_NO_PAD.encode(secret.public_key().to_encoded_point(false).as_bytes()),
                "auth": URL_SAFE_NO_PAD.encode(auth),
            }
        });
        let key = ES256KeyPair::generate();
        let request = request(&subscription, &key, "mailto:a@b.c", "{\"title\":\"pi\"}").unwrap();
        assert!(
            request.headers()["authorization"]
                .to_str()
                .unwrap()
                .starts_with("vapid t=")
        );
        let plain = web_push_native::decrypt(
            request.into_body(),
            &secret,
            web_push_native::Auth::from_slice(&auth),
        )
        .unwrap();
        assert_eq!(plain, br#"{"title":"pi"}"#);
    }
}
