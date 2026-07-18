import { timingSafeEqual } from "node:crypto";

export function assertMutationOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const expected = process.env.RELAY_ORIGIN?.replace(/\/$/, "") || new URL(request.url).origin;
  if (!origin || !safeEqual(origin.replace(/\/$/, ""), expected)) {
    throw new Error("Invalid request origin");
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
