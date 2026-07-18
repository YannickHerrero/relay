const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "incorrect-password": "Incorrect password",
  "invalid-password": "Password must contain between 4 and 256 characters",
  "invalid-request": "Unable to process the authentication request. Try again.",
  "rate-limited": "Too many login attempts. Try again in 15 minutes.",
};

export function authErrorMessage(code: string | string[] | undefined): string | undefined {
  return typeof code === "string" ? AUTH_ERROR_MESSAGES[code] : undefined;
}
