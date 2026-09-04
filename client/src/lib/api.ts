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
const client = hc<AppType>(import.meta.env.VITE_API_ORIGIN ?? "");

export const api = client.api;

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
