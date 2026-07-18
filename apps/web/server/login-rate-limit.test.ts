import { createDatabase, loginRateLimits } from "@relay/db";
import { afterEach, describe, expect, it } from "vitest";

import {
  LOGIN_ATTEMPT_WINDOW_MS,
  LOGIN_BLOCK_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  createLoginRateLimiter,
} from "./login-rate-limit";

const openDatabases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const relayDatabase of openDatabases.splice(0)) relayDatabase.sqlite.close();
});

describe("owner login rate limiter", () => {
  it("blocks after five failures and reports the remaining delay", () => {
    const relayDatabase = createTestDatabase();
    const limiter = createLoginRateLimiter(relayDatabase);
    const now = new Date("2026-01-01T00:00:00.000Z");

    for (let attempt = 0; attempt < MAX_FAILED_LOGIN_ATTEMPTS - 1; attempt += 1) {
      limiter.recordFailure(now);
      expect(limiter.check(now)).toEqual({ limited: false });
    }

    limiter.recordFailure(now);
    expect(limiter.check(now)).toEqual({
      limited: true,
      retryAfterSeconds: LOGIN_BLOCK_DURATION_MS / 1000,
    });
    expect(limiter.check(new Date(now.getTime() + LOGIN_BLOCK_DURATION_MS - 1_000))).toEqual({
      limited: true,
      retryAfterSeconds: 1,
    });
    expect(limiter.check(new Date(now.getTime() + LOGIN_BLOCK_DURATION_MS))).toEqual({
      limited: false,
    });
  });

  it("expires an incomplete attempt window", () => {
    const relayDatabase = createTestDatabase();
    const limiter = createLoginRateLimiter(relayDatabase);
    const now = new Date("2026-01-01T00:00:00.000Z");

    for (let attempt = 0; attempt < MAX_FAILED_LOGIN_ATTEMPTS - 1; attempt += 1) {
      limiter.recordFailure(now);
    }
    expect(limiter.check(new Date(now.getTime() + LOGIN_ATTEMPT_WINDOW_MS))).toEqual({
      limited: false,
    });
    expect(relayDatabase.db.select().from(loginRateLimits).all()).toHaveLength(0);
  });

  it("clears failures after a successful login", () => {
    const relayDatabase = createTestDatabase();
    const limiter = createLoginRateLimiter(relayDatabase);

    limiter.recordFailure();
    limiter.reset();

    expect(limiter.check()).toEqual({ limited: false });
    expect(relayDatabase.db.select().from(loginRateLimits).all()).toHaveLength(0);
  });
});

function createTestDatabase(): ReturnType<typeof createDatabase> {
  const relayDatabase = createDatabase(":memory:");
  openDatabases.push(relayDatabase);
  return relayDatabase;
}
