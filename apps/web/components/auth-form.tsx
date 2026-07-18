"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function AuthForm({ mode }: { mode: "setup" | "login" }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: form.get("password") }),
    });
    const body = (await response.json()) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(body.error ?? "Something went wrong");
      return;
    }
    router.replace("/board");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-7 space-y-4">
      <div>
        <label className="label" htmlFor="password">
          Owner password
        </label>
        <input
          className="field"
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "setup" ? "new-password" : "current-password"}
          minLength={mode === "setup" ? 4 : 1}
          maxLength={256}
          required
          autoFocus
        />
        {mode === "setup" ? (
          <p className="mt-2 text-xs text-[var(--relay-muted)]">
            Use at least 4 characters. Relay stores an Argon2id hash.
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-[var(--relay-danger)]">
          {error}
        </p>
      ) : null}
      <button className="button button-primary w-full" disabled={pending}>
        {pending ? "Working…" : mode === "setup" ? "Create owner account" : "Sign in to Relay"}
      </button>
    </form>
  );
}
