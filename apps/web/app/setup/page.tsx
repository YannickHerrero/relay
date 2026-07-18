import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { hasOwner } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await hasOwner()) redirect("/login");
  return (
    <main className="grid min-h-screen place-items-center p-5">
      <section className="surface w-full max-w-md p-7 sm:p-9">
        <p className="kicker">First-run setup</p>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.045em]">
          Secure Relay<span className="text-[var(--relay-accent)]">.</span>
        </h1>
        <p className="mt-3 text-sm text-[var(--relay-muted)]">
          Create the single owner account before exposing Relay through Tailscale.
        </p>
        <AuthForm mode="setup" />
      </section>
    </main>
  );
}
