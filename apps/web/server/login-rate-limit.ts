import { loginRateLimits, type RelayDatabase } from "@relay/db";
import { eq } from "drizzle-orm";

const RATE_LIMIT_KEY = "owner-login";
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_BLOCK_DURATION_MS = 15 * 60 * 1000;

export type LoginRateLimitStatus =
  { limited: false } | { limited: true; retryAfterSeconds: number };

export function createLoginRateLimiter(relayDatabase: RelayDatabase) {
  const { db, sqlite } = relayDatabase;

  return {
    check(now = new Date()): LoginRateLimitStatus {
      return sqlite.transaction((): LoginRateLimitStatus => {
        const current = db
          .select()
          .from(loginRateLimits)
          .where(eq(loginRateLimits.key, RATE_LIMIT_KEY))
          .get();
        if (!current) return { limited: false };

        const nowMs = now.getTime();
        const blockedUntilMs = current.blockedUntil
          ? new Date(current.blockedUntil).getTime()
          : undefined;
        if (blockedUntilMs !== undefined && blockedUntilMs > nowMs) {
          return {
            limited: true,
            retryAfterSeconds: Math.max(1, Math.ceil((blockedUntilMs - nowMs) / 1000)),
          };
        }

        const firstFailedAtMs = new Date(current.firstFailedAt).getTime();
        if (blockedUntilMs !== undefined || nowMs - firstFailedAtMs >= LOGIN_ATTEMPT_WINDOW_MS) {
          db.delete(loginRateLimits).where(eq(loginRateLimits.key, RATE_LIMIT_KEY)).run();
        }
        return { limited: false };
      })();
    },

    recordFailure(now = new Date()): void {
      sqlite.transaction(() => {
        const current = db
          .select()
          .from(loginRateLimits)
          .where(eq(loginRateLimits.key, RATE_LIMIT_KEY))
          .get();
        const nowMs = now.getTime();
        const blockedUntilMs = current?.blockedUntil
          ? new Date(current.blockedUntil).getTime()
          : undefined;

        if (blockedUntilMs !== undefined && blockedUntilMs > nowMs) return;

        const firstFailedAtMs = current ? new Date(current.firstFailedAt).getTime() : undefined;
        const continuesWindow =
          current !== undefined &&
          blockedUntilMs === undefined &&
          firstFailedAtMs !== undefined &&
          nowMs - firstFailedAtMs < LOGIN_ATTEMPT_WINDOW_MS;
        const failedAttempts = continuesWindow ? current.failedAttempts + 1 : 1;
        const firstFailedAt = continuesWindow ? current.firstFailedAt : now.toISOString();
        const blockedUntil =
          failedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS
            ? new Date(nowMs + LOGIN_BLOCK_DURATION_MS).toISOString()
            : null;

        db.insert(loginRateLimits)
          .values({
            key: RATE_LIMIT_KEY,
            failedAttempts,
            firstFailedAt,
            blockedUntil,
            updatedAt: now.toISOString(),
          })
          .onConflictDoUpdate({
            target: loginRateLimits.key,
            set: { failedAttempts, firstFailedAt, blockedUntil, updatedAt: now.toISOString() },
          })
          .run();
      })();
    },

    reset(): void {
      db.delete(loginRateLimits).where(eq(loginRateLimits.key, RATE_LIMIT_KEY)).run();
    },
  };
}
