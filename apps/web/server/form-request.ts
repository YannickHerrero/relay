import { NextResponse } from "next/server";

const FORM_CONTENT_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data"];

export function isFormSubmission(request: Request): boolean {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  return FORM_CONTENT_TYPES.some((candidate) => contentType.startsWith(candidate));
}

export async function readRequestBody(request: Request): Promise<unknown> {
  if (!isFormSubmission(request)) return request.json();
  return Object.fromEntries(await request.formData());
}

export function formRedirect(path: string, headers?: HeadersInit): NextResponse {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Location", path);
  return new NextResponse(null, { status: 303, headers: responseHeaders });
}
