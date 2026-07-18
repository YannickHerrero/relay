"use client";

import { Bell, BellRing, CheckCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type RelayNotification = {
  id: string;
  taskId: string | null;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RelayNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    async function load() {
      const response = await fetch("/api/notifications");
      if (!response.ok) return;
      const data = (await response.json()) as { items: RelayNotification[]; unread: number };
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        for (const item of data.items.filter(
          (candidate) => !candidate.readAt && !seen.current.has(candidate.id),
        )) {
          if (seen.current.size) new Notification(item.title, { body: item.body, tag: item.id });
          seen.current.add(item.id);
        }
      }
      setItems(data.items);
      setUnread(data.unread);
    }
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, []);

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    setItems((current) =>
      current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })),
    );
    setUnread(0);
  }

  async function enableBrowserNotifications() {
    if (typeof Notification !== "undefined") await Notification.requestPermission();
  }

  return (
    <div className="relay-notification-center">
      <button
        className="relay-notification-button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`${unread} unread notifications`}
      >
        {unread ? <BellRing size={16} /> : <Bell size={16} />}
        {unread ? <span>{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="relay-notification-popover">
          <header>
            <div>
              <p className="kicker">Intervention only</p>
              <h2>Notifications</h2>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close">
              <X size={15} />
            </button>
          </header>
          <div className="relay-notification-tools">
            <button onClick={markAllRead}>
              <CheckCheck size={12} /> Mark all read
            </button>
            {typeof Notification !== "undefined" && Notification.permission === "default" ? (
              <button onClick={enableBrowserNotifications}>Enable browser alerts</button>
            ) : null}
          </div>
          <div className="relay-notification-list">
            {items.map((item) => (
              <Link
                href={item.taskId ? `/tasks/${item.taskId}` : "/activity"}
                onClick={() => setOpen(false)}
                className={item.readAt ? "" : "unread"}
                key={item.id}
              >
                <i />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  <time>{new Date(item.createdAt).toLocaleString()}</time>
                </div>
              </Link>
            ))}
            {!items.length ? <p>No intervention is needed.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
