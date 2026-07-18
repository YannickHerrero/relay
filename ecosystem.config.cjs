module.exports = {
  apps: [
    {
      name: "relay-web",
      cwd: __dirname,
      script: "pnpm",
      args: "--filter @relay/web start",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
        RELAY_DATA_DIR: process.env.RELAY_DATA_DIR || `${process.env.HOME}/.relay`,
        RELAY_ORIGIN: process.env.RELAY_ORIGIN || "http://localhost:3000",
        RELAY_SECURE_COOKIES: process.env.RELAY_SECURE_COOKIES || "false",
      },
    },
    {
      name: "relay-worker",
      cwd: __dirname,
      script: "pnpm",
      args: "--filter @relay/worker start",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 30000,
      env: {
        NODE_ENV: "production",
        RELAY_DATA_DIR: process.env.RELAY_DATA_DIR || `${process.env.HOME}/.relay`,
        RELAY_CODEX_COMMAND: process.env.RELAY_CODEX_COMMAND || "codex",
        RELAY_WORKER_CONCURRENCY: process.env.RELAY_WORKER_CONCURRENCY || "2",
      },
    },
  ],
};
