export default function HomePage() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="surface w-full max-w-lg p-8">
        <p className="kicker">Local agent control plane</p>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.045em]">
          Relay<span className="text-[var(--relay-accent)]">.</span>
        </h1>
        <p className="mt-3 text-[var(--relay-muted)]">
          Refine requirements, approve atomic plans, follow implementation evidence, and deploy only
          when you decide.
        </p>
        <div className="mt-6 flex items-center gap-2 text-xs text-[var(--relay-muted)]">
          <span
            className="inline-block size-2 rounded-full bg-[var(--relay-accent)]"
            aria-hidden="true"
          />
          Relay is ready for setup
        </div>
      </section>
    </main>
  );
}
