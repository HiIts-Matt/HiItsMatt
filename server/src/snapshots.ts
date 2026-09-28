import { createHash } from "node:crypto";
import { cached } from "./cache.js";
import { GitHubError } from "./github/rest.js";
import { store } from "./store/index.js";

type Snapshot = { savedAt: string; value: unknown };

/**
 * Hash of the last value this execution environment wrote per key. A refresh
 * that returns what is already saved costs nothing; a cold start writes once.
 */
const savedHashes = new Map<string, string>();

/** Snapshot keys are cache keys, which contain `:` and `/`. */
function snapshotKey(key: string): string {
  return `snapshots/github/${encodeURIComponent(key)}.json`;
}

async function save(key: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  const hash = createHash("sha1").update(serialized).digest("hex");

  if (savedHashes.get(key) === hash) {
    return;
  }

  try {
    await store.write(snapshotKey(key), { savedAt: new Date().toISOString(), value } satisfies Snapshot);
    savedHashes.set(key, hash);
  } catch (error) {
    // Losing a snapshot costs resilience, not this response.
    console.error(`Could not save the snapshot for "${key}" to ${store.location}:`, error);
  }
}

async function restore<T>(key: string, cause: unknown): Promise<T> {
  let snapshot: Snapshot | null;

  try {
    snapshot = (await store.read(snapshotKey(key))) as Snapshot | null;
  } catch (error) {
    console.error(`Could not read the snapshot for "${key}" from ${store.location}:`, error);
    throw cause;
  }

  if (!snapshot) {
    throw cause;
  }

  console.warn(
    `GitHub failed for "${key}" (${cause instanceof Error ? cause.message : String(cause)}); serving the snapshot saved ${snapshot.savedAt}.`,
  );

  return snapshot.value as T;
}

/**
 * `cached`, plus a durable last-known-good copy of every successful load. When
 * GitHub is down or rate limited, the snapshot is served instead of an error,
 * and it is held in memory for the same TTL, so the next attempt at GitHub
 * happens on the usual refresh clock rather than on every request.
 *
 * Use it on entries whose loader calls GitHub itself. Entries assembled from
 * other cached entries (the repo list with its excerpts, the language totals,
 * the project index) are rebuilt from these leaves and need no copy of their
 * own — and must not have one: those loaders swallow per-item failures, so an
 * outage would look like a successful, empty result and overwrite a good copy.
 *
 * Values must be JSON: that is what the snapshot stores.
 */
export function snapshotted<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  return cached(key, ttlMs, async () => {
    let value: T;

    try {
      value = await load();
    } catch (error) {
      // Only failures that mean "GitHub is not answering right now" fall back:
      // 502 (unreachable or erroring) and 429 (rate limited). A 404 is an
      // answer, and a 503 is this server's own missing token — serving stale
      // data would hide both.
      if (!(error instanceof GitHubError && (error.status === 502 || error.status === 429))) {
        throw error;
      }

      return await restore<T>(key, error);
    }

    await save(key, value);

    return value;
  });
}
