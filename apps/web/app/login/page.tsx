import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { currentUser, hasOwner } from "@/server/auth";
import { authErrorMessage } from "@/server/auth-request";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  if (!(await hasOwner())) redirect("/setup");
  if (await currentUser()) redirect("/board");
  const error = authErrorMessage((await searchParams).error);
  return (
    <main className="grid min-h-screen place-items-center p-5">
      <section className="surface w-full max-w-md p-7 sm:p-9">
        <p className="kicker">Owner access</p>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.045em]">
          Relay<span className="text-[var(--relay-accent)]">.</span>
        </h1>
        <p className="mt-3 text-sm text-[var(--relay-muted)]">
          Sign in to inspect and control your coding agents.
        </p>
        <AuthForm mode="login" initialError={error} />
      </section>
    </main>
  );
}
