import { useEffect, useState } from "react";

export type Resource<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

/**
 * One request per key for the life of the page. The homepage's cards read the
 * same career, project and GitHub data as the pages they open, and none of it
 * changes while the site is open, so every reader shares the first request. A
 * failed request is forgotten, so the next reader to mount tries again.
 */
const requests = new Map<string, Promise<unknown>>();

/**
 * Minimal async data hook. `key` identifies the request; the loader only runs
 * for the first reader of a key, and an inline arrow is fine.
 *
 * StrictMode mounts effects twice in development, hence the cancellation flag —
 * without it the second run's state update races the first.
 */
export function useResource<T>(key: string, load: () => Promise<T>): Resource<T> {
  const [resource, setResource] = useState<Resource<T>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setResource({ status: "loading" });

    let request = requests.get(key) as Promise<T> | undefined;
    if (!request) {
      request = load();
      requests.set(key, request);
      request.catch(() => requests.delete(key));
    }

    request
      .then((data) => {
        if (!cancelled) setResource({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResource({
          status: "error",
          message: error instanceof Error ? error.message : "Request failed",
        });
      });

    return () => {
      cancelled = true;
    };
    // The loader closure changes identity every render; `key` is the real input.
  }, [key]);

  return resource;
}
