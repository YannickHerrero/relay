"use client";

import {
  Activity,
  Archive,
  Bot,
  Boxes,
  Columns3,
  LogOut,
  Menu,
  Rocket,
  Settings2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { NotificationCenter } from "./notification-center";

const navigation = [
  { href: "/board", label: "Board", icon: Columns3 },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/projects", label: "Projects", icon: Boxes },
  { href: "/runs", label: "Runs", icon: Bot },
  { href: "/deployments", label: "Deployments", icon: Rocket },
  { href: "/archive", label: "Archive", icon: Archive },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="relay-shell">
      <header className="relay-topbar">
        <button
          className="relay-menu-button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>
        <Link href="/board" className="relay-brand" aria-label="Relay board">
          Relay<span>.</span>
        </Link>
        <div className="relay-crumb">Local workspace</div>
        <div className="relay-top-actions">
          <span className="relay-agent-state">
            <i /> Agent host ready
          </span>
          <Link href="/projects" className="button">
            <Settings2 size={14} /> Configure
          </Link>
          <NotificationCenter />
          <div className="relay-avatar" aria-label="Owner account">
            R
          </div>
        </div>
      </header>
      {open ? (
        <button
          className="relay-nav-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside className={`relay-sidebar ${open ? "is-open" : ""}`}>
        <div className="relay-mobile-nav-head">
          <span className="relay-brand">
            Relay<span>.</span>
          </span>
          <button onClick={() => setOpen(false)} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>
        <p className="relay-side-label">Workspace</p>
        <nav className="relay-nav">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={active ? "active" : ""}
                onClick={() => setOpen(false)}
              >
                <Icon size={15} strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="relay-host-block">
          <p className="relay-side-label">Connected host</p>
          <div className="relay-host-card">
            <span className="relay-status-dot" />
            <strong>
              {typeof window === "undefined" ? "Relay host" : window.location.hostname}
            </strong>
            <small>online · worker observed</small>
          </div>
        </div>
        <p className="relay-side-note">
          Agents work in isolated worktrees. Review is automatic; deployment requires approval.
        </p>
        <button className="relay-signout" onClick={logout}>
          <LogOut size={14} /> Sign out
        </button>
      </aside>
      <main className="relay-content">{children}</main>
    </div>
  );
}
