/**
 * Helpers for calling route `action`/`loader` functions directly.
 * Import `./db` (or `../helpers/db`) before this in every test file.
 */
import "./db";

const ORIGIN = "http://localhost";

/** A `Cookie` header value for a signed-in session as `userId`. */
export async function sessionCookie(userId: number): Promise<string> {
  const { createUserSession } = await import("~/lib/auth.server");
  const response = await createUserSession({
    request: new Request(`${ORIGIN}/login`),
    userId,
    redirectTo: "/",
  });
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("createUserSession did not set a cookie");
  return setCookie.split(";")[0];
}

export function formRequest(
  pathname: string,
  fields: Record<string, string | number>,
  cookie?: string,
): Request {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) body.set(k, String(v));
  return new Request(`${ORIGIN}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body,
  });
}

export function getRequest(pathname: string, cookie?: string): Request {
  return new Request(`${ORIGIN}${pathname}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

type Handler = (args: any) => unknown;

/**
 * Runs a route handler. A thrown Response (redirect, 404) is returned like a
 * returned one; any other thrown value propagates and fails the test.
 */
export async function run<T = unknown>(
  handler: Handler,
  request: Request,
  params: Record<string, string> = {},
): Promise<T | Response> {
  try {
    return (await handler({ request, params, context: {} })) as T;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

/** HTTP status of a handler result; a non-Response result (data, null) counts as 200. */
export function statusOf(result: unknown): number {
  return result instanceof Response ? result.status : 200;
}
