type Entry<T> = { value: T; expiresAt: number };

const entries = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * TTL cache with single-flight loading: concurrent misses on the same key share
 * one upstream request, which is what keeps the GitHub rate limit survivable
 * when several sections of the page mount at once. Rejections are never cached.
 */
export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const entry = entries.get(key);

  if (entry && entry.expiresAt > Date.now()) {
    return Promise.resolve(entry.value as T);
  }

  const pending = inFlight.get(key);

  if (pending) {
    return pending as Promise<T>;
  }

  const promise = load()
    .then((value) => {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);

  return promise;
}
