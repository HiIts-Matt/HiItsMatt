import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Small JSON documents addressed by a slash-separated key, e.g.
 * `career/content.json`. Whole documents are read and written at once: there
 * are a handful of them, each a few KB, and nothing here ever queries inside
 * one — which is why this is object storage and not a database.
 *
 * `read` resolves to null for a key that has never been written, so callers can
 * tell "not published yet" apart from a store that is actually failing.
 */
export type DocumentStore = {
  /** Where the documents live, for log lines and CLI output. */
  readonly location: string;
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
};

export type StoreConfig =
  | { kind: "s3"; bucket: string; region?: string }
  | { kind: "fs"; dir: string };

/** Keys are ours, never a visitor's, but a bad one must not escape the root. */
const KEY = /^[A-Za-z0-9._%-]+(?:\/[A-Za-z0-9._%-]+)*$/;

function checkKey(key: string): string {
  if (!KEY.test(key) || key.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Invalid document key "${key}".`);
  }

  return key;
}

function parse(text: string, where: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${where} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function s3Store(bucket: string, region: string | undefined): DocumentStore {
  // Credentials come from the default chain: the execution role on Lambda,
  // AWS_PROFILE or `aws configure` everywhere else.
  const client = new S3Client(region ? { region } : {});

  return {
    location: `s3://${bucket}`,

    async read(key) {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: checkKey(key) }));

        return parse(await object.Body!.transformToString("utf-8"), `s3://${bucket}/${key}`);
      } catch (error) {
        // NoSuchKey needs s3:ListBucket; without it S3 answers AccessDenied for
        // a missing key, which surfaces as a real failure below.
        if (error instanceof NoSuchKey) {
          return null;
        }

        throw error;
      }
    },

    async write(key, value) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: checkKey(key),
          Body: JSON.stringify(value),
          ContentType: "application/json; charset=utf-8",
        }),
      );
    },
  };
}

function fsStore(dir: string): DocumentStore {
  const root = resolve(dir);
  const pathOf = (key: string) => {
    const path = resolve(root, ...checkKey(key).split("/"));

    if (!path.startsWith(root + sep)) {
      throw new Error(`Invalid document key "${key}".`);
    }

    return path;
  };

  return {
    location: root,

    async read(key) {
      const path = pathOf(key);

      try {
        return parse(await readFile(path, "utf-8"), path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }

        throw error;
      }
    },

    async write(key, value) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      // Write-then-rename, so a reader never sees half a document.
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
      await rename(temp, path);
    },
  };
}

export function createStore(config: StoreConfig): DocumentStore {
  return config.kind === "s3" ? s3Store(config.bucket, config.region) : fsStore(config.dir);
}
