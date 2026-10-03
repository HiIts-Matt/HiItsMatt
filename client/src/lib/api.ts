import { hc } from "hono/client";
import type { AppType } from "server";

/**
 * `AppType` is imported as a type only, so no server code reaches the bundle —
 * but renaming a route or changing a response shape breaks the build here
 * instead of at runtime.
 *
 * The Hono app declares `basePath("/api")`, so the base is an origin and `/api`
 * comes from the typed path itself. An empty base means "current origin", which
 * the Vite dev server proxies to the API process.
 */
const apiOrigin = import.meta.env.VITE_API_ORIGIN ?? "";

/**
 * In production the API sits behind CloudFront, which signs each request to
 * the Lambda function URL (origin access control). For a request with a body
 * Lambda only accepts the signature if the browser has sent the body's SHA-256
 * along with it, so every body gets hashed here, from the exact string sent.
 *
 * `crypto.subtle` exists only on secure origins: https, and localhost in
 * development. A dev server opened over a LAN address skips the header, which
 * nothing but CloudFront checks.
 */
async function hashedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof init?.body !== "string" || !globalThis.crypto?.subtle) return fetch(input, init);

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(init.body));
  const headers = new Headers(init.headers);
  headers.set(
    "x-amz-content-sha256",
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  );

  return fetch(input, { ...init, headers });
}

const client = hc<AppType>(apiOrigin, { fetch: hashedFetch });

export const api = client.api;

/**
 * Absolute URL for a path the server put inside a JSON payload — project media,
 * which is streamed rather than fetched as RPC. The typed client cannot build
 * these because they are data, not routes.
 */
export function apiUrl(path: string): string {
  return `${apiOrigin}${path}`;
}

/** Structurally compatible with Hono's `ClientResponse`, without depending on it. */
type JsonResponse<T> = {
  ok: boolean;
  status: number;
  json: () => Promise<T>;
};

/**
 * Resolves a typed RPC call to its payload, or throws with the server's own
 * `{ error }` message so failures such as "contribution graph requires
 * GITHUB_TOKEN" reach the screen intact.
 */
export async function unwrap<T>(request: Promise<JsonResponse<T>>, fallback: string): Promise<T> {
  let response: JsonResponse<T>;
  try {
    response = await request;
  } catch {
    // fetch() only rejects on transport failure — the API process is down.
    throw new Error(`${fallback} (the API is not reachable)`);
  }

  if (response.ok) return await response.json();

  let message = fallback;
  try {
    const body: unknown = await (response as JsonResponse<unknown>).json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      message = body.error;
    }
  } catch {
    // Non-JSON error bodies (proxy timeouts, HTML error pages) keep the fallback.
  }
  throw new Error(message);
}
