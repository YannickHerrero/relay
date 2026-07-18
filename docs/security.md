# Relay security

Relay intentionally gives implementation agents broad command access. Application authentication is not a substitute for operating-system isolation.

## Dedicated macOS account

Run Relay under a local account used only for agent work. Keep repositories, Relay data, Codex state, and required development tools in that account's home directory. Do not run Relay under a personal account with access to documents, unrelated repositories, a personal Keychain, or broad cloud credentials.

## Credentials

Use dedicated restricted credentials:

- a GitHub SSH key or token limited to required repositories;
- project-scoped Vercel credentials;
- a dedicated App Store Connect API key;
- dedicated EAS credentials;
- only the environment secrets required by registered projects.

Relay does not store deployment tokens in its database. Commands inherit the worker process environment and the dedicated account's configured tool credentials.

## Network

Bind Next.js to localhost and expose it through Tailscale Serve. Do not open the port publicly. Set `RELAY_ORIGIN` to the exact HTTPS Tailscale origin and `RELAY_SECURE_COOKIES=true`.

Relay uses a single-owner password with Argon2id hashing, random hashed sessions, HTTP-only SameSite cookies, mutation-origin checks, authenticated artifacts, and one-time deployment confirmations. Four-character passcodes are accepted for tailnet-only installations, but Relay does not currently rate-limit login attempts; use a longer password whenever untrusted devices can reach the service.

## Trust boundaries

- Registered repository content is untrusted input to the agent.
- `.relay/project.config.ts` is trusted executable configuration.
- Plan test commands are approved when the owner approves the plan.
- Deployment commands are trusted only after a separate explicit confirmation.
- Codex is local and never exposed directly over Tailscale.
- A deployment diagnostician receives logs in read-only mode and cannot rerun a command.

Review project configuration, plan commands, changed files, Git evidence, and the exact deployment confirmation before approving sensitive work.
