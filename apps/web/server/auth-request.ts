import { NextResponse } from "next/server";

const FORM_CONTENT_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data"];
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "incorrect-password": "Incorrect password",
  "invalid-password": "Password must contain between 4 and 256 characters",
  "invalid-request": "Unable to process the authentication request. Try again.",
  "rate-limited": "Too many login attempts. Try again in 15 minutes.",
};

export function authErrorMessage(code: string | string[] | undefined): string | undefined {
  return typeof code === "string" ? AUTH_ERROR_MESSAGES[code] : undefined;
}

export function isFormSubmission(request: Request): boolean {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  return FORM_CONTENT_TYPES.some((candidate) => contentType.startsWith(candidate));
}

export async function readAuthBody(request: Request): Promise<unknown> {
  if (!isFormSubmission(request)) return request.json();
  const form = await request.formData();
  return { password: form.get("password") };
}

export function formRedirect(path: string, headers?: HeadersInit): NextResponse {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Location", path);
  return new NextResponse(null, { status: 303, headers: responseHeaders });
}
