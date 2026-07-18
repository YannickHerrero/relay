export default {
  commands: {
    setup: ["pnpm install"],
    lint: ["pnpm lint"],
    typecheck: ["pnpm typecheck"],
    unitTests: ["pnpm test"],
    build: ["pnpm build"],
    finalValidation: ["pnpm lint", "pnpm typecheck", "pnpm test", "pnpm build"],
  },
  preview: {
    startCommand: "pnpm dev",
    healthcheckUrl: "http://localhost:3000",
  },
  deploymentRecipes: [
    {
      id: "git-push",
      label: "Push reviewed branch",
      description: "Push the exact reviewed Relay task branch to its configured Git origin.",
      kind: "git_push",
      environment: "Git remote",
      requiresConfirmation: true,
    },
  ],
};
