# Project configuration

Relay snapshots trusted repository configuration from `.relay/project.config.ts`. The compatibility path `.agent-board/project.config.ts` is also read when the Relay path is absent.

The file executes as trusted local TypeScript while loading. Only register repositories controlled by the Relay owner.

```ts
export default {
  commands: {
    setup: ["pnpm install"],
    lint: ["pnpm lint"],
    typecheck: ["pnpm typecheck"],
    unitTests: ["pnpm test"],
    integrationTests: ["pnpm test:integration"],
    build: ["pnpm build"],
    finalValidation: ["pnpm lint", "pnpm typecheck", "pnpm test", "pnpm build"],
  },
  preview: {
    startCommand: "pnpm dev",
    healthcheckUrl: "http://localhost:3000",
  },
  deploymentRecipes: [],
};
```

All command arrays are optional. Commands run through `/bin/bash -lc` in the isolated task worktree. Configure timeouts with `RELAY_COMMAND_TIMEOUT_MS` and `RELAY_DEPLOYMENT_TIMEOUT_MS`.

## Deployment recipes

### Git push

```ts
{
  id: "git-push",
  label: "Push reviewed branch",
  kind: "git_push",
  environment: "GitHub",
  requiresConfirmation: true,
}
```

Relay derives the exact task branch. It validates a clean worktree and reviewed SHA before issuing `git push --set-upstream origin <branch>`.

### Vercel preview

```ts
{
  id: "vercel-preview",
  label: "Deploy Vercel preview",
  kind: "command",
  commands: ["vercel deploy"],
  environment: "Preview",
  requiresConfirmation: true,
}
```

### TestFlight

```ts
{
  id: "testflight",
  label: "Send to TestFlight",
  kind: "command",
  commands: ["bundle exec fastlane beta"],
  environment: "App Store Connect",
  requiresConfirmation: true,
}
```

Relay always requires an authenticated confirmation, even if a configuration sets `requiresConfirmation` to false. A confirmation is one-use, expires after five minutes, and snapshots the exact recipe and commit SHA.

## Refreshing configuration

Use **Projects → Project → Refresh config** after changing the file. A new version is created only when the validated configuration hash changes. Historical runs retain their previous snapshot.
