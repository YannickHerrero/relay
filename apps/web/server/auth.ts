import { createHash, randomBytes, randomUUID } from "node:crypto";

import { sessions, users } from "@relay/db";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hash, verify } from "@node-rs/argon2";

import { database } from "./database";

const SESSION_COOKIE = "relay_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30;

export async function hasOwner(): Promise<boolean> {
  return database().db.select({ id: users.id }).from(users).limit(1).get() !== undefined;
}

export async function createOwner(password: string): Promise<void> {
  validatePassword(password);
  const { db, sqlite } = database();
  const now = new Date().toISOString();
  const passwordHash = await hash(password, {
    algorithm: 2,
    memoryCost: 19_456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });

  sqlite.transaction(() => {
    if (db.select({ id: users.id }).from(users).limit(1).get()) {
      throw new Error("Relay has already been set up");
    }
    db.insert(users)
      .values({ id: randomUUID(), passwordHash, createdAt: now, updatedAt: now })
      .run();
  })();
}

export async function authenticate(password: string): Promise<string | null> {
  const owner = database().db.select().from(users).limit(1).get();
  if (!owner || !(await verify(owner.passwordHash, password))) return null;
  return owner.id;
}

export async function createSession(userId: string): Promise<void> {
  const rawToken = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
  database()
    .db.insert(sessions)
    .values({
      id: randomUUID(),
      userId,
      tokenHash: hashToken(rawToken),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })
    .run();

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.RELAY_SECURE_COOKIES === "true",
    path: "/",
    expires: expiresAt,
  });
}

export async function currentUser() {
  const rawToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!rawToken) return null;
  const now = new Date().toISOString();
  const row = database()
    .db.select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(rawToken)), gt(sessions.expiresAt, now)))
    .get();
  return row?.user ?? null;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (rawToken) {
    database()
      .db.delete(sessions)
      .where(eq(sessions.tokenHash, hashToken(rawToken)))
      .run();
  }
  cookieStore.delete(SESSION_COOKIE);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 256) {
    throw new Error("Password must contain between 12 and 256 characters");
  }
}
