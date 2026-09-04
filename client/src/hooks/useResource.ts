import { useEffect, useState } from "react";

export type Resource<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

/**
 * Minimal async data hook. `key` identifies the request; the loader is read
 * fresh on every run so an inline arrow does not restart the fetch loop.
 *
 * StrictMode mounts effects twice in development, hence the cancellation flag —
 * without it the second run's state update races the first.
 */
export function useResource<T>(key: string, load: () => Promise<T>): Resource<T> {
  const [resource, setResource] = useState<Resource<T>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setResource({ status: "loading" });

    load()
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
