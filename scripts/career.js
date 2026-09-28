/**
 * Publishes the career page's data. The page reads everything from the data
 * store (see server/src/career/schema.ts); this is the only thing that writes
 * it, and each command owns its own documents.
 *
 *   npm run career -- activity   Weekly commit counts per product, from the git
 *                                history of work clones on this machine.
 *   npm run career -- push       Validates .career/content.json and publishes it,
 *                                with every logo it names from .career/assets/.
 *   npm run career -- pull       Downloads the published content and its logos
 *                                into .career/ for editing.
 *
 * A new employer is an entry in content.json plus its logos in .career/assets/,
 * then a push: nothing about the site needs to change.
 *
 * Flags:
 *   --local      Use server/.data (what `npm run dev` reads) instead of S3.
 *   --no-fetch   activity: skip `git fetch`, count only what is already local.
 *   --dry-run    activity: print the summary, write nothing.
 *   --force      pull: overwrite local content that differs from what is published.
 *
 * S3 is addressed with DATA_BUCKET, AWS_REGION and AWS_PROFILE from
 * .env.deploy — the same credentials the deploy uses.
 *
 * Why local git rather than GitHub: the work repositories belong to another
 * account, and the only token that could read their history would also read
 * every line of their source. Only dates and counts leave this machine — no
 * code, messages, hashes, file names or repository names.
 *
 * .career/sources.json (gitignored — it names private repositories) maps each
 * product id to the clones that count towards it. Repo paths are relative to
 * this repository's root. `paths` limits a source to those directories;
 * `exclude` counts everything but them. A commit that touches both halves of a
 * split repository counts for both products.
 *
 * `rest` names one more product that collects everything else: every commit in
 * any clone next to this repository whose GitHub owner is `owner`, minus the
 * commits the products above already counted. It is how work that has no
 * public name yet — or no name worth a card — still shows on the timeline,
 * without this file naming it. See scripts/career-sources.example.json.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assetContentType,
  CAREER_ACTIVITY_KEY,
  CAREER_CONTENT_KEY,
  careerAssetKey,
  CareerDataError,
  MAX_ASSET_BYTES,
  parseCareerActivity,
  parseCareerContent,
} from "../server/src/career/schema.ts";
import { createStore } from "../server/src/store/documents.ts";

const root = resolve(import.meta.dirname, "..");
const workDir = resolve(root, ".career");
const sourcesPath = resolve(workDir, "sources.json");
const contentPath = resolve(workDir, "content.json");
const assetsDir = resolve(workDir, "assets");

/** Every logo file name the content uses, once each. */
function logosOf(content) {
  return [...new Set(content.jobs.flatMap((job) => job.products.flatMap((product) => (product.logo ? [product.logo] : []))))];
}

const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest);

function fail(message) {
  console.error(`\x1b[31m${message}\x1b[0m`);
  process.exit(1);
}

function openStore() {
  if (flags.has("--local")) {
    return createStore({ kind: "fs", dir: resolve(root, "server", ".data") });
  }

  const configPath = resolve(root, ".env.deploy");

  if (existsSync(configPath)) {
    process.loadEnvFile(configPath);
  }

  const bucket = process.env.DATA_BUCKET?.trim();

  if (!bucket) {
    fail("DATA_BUCKET is not set in .env.deploy. Pass --local to use server/.data instead.");
  }

  return createStore({ kind: "s3", bucket, region: process.env.AWS_REGION?.trim() || undefined });
}

function readJsonFile(path) {
  if (!existsSync(path)) {
    fail(`${path} does not exist.`);
  }

  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
  }
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Monday of the calendar date an ISO timestamp was written on, as YYYY-MM-DD. */
function mondayOf(isoTimestamp) {
  // The author's own local date, not UTC: a commit at 9am in Melbourne belongs
  // to that day even though it is still yesterday in UTC.
  const day = new Date(`${isoTimestamp.slice(0, 10)}T00:00:00Z`);
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - sinceMonday);

  return day.toISOString().slice(0, 10);
}

function loadSources() {
  const sources = readJsonFile(sourcesPath);
  const authors = sources.authors;

  if (!Array.isArray(authors) || authors.length === 0 || !authors.every((a) => typeof a === "string" && a)) {
    fail(`${sourcesPath}: "authors" must be a non-empty list of email addresses.`);
  }

  if (typeof sources.products !== "object" || sources.products === null) {
    fail(`${sourcesPath}: "products" must map product ids to lists of sources.`);
  }

  const products = Object.entries(sources.products).map(([id, entries]) => {
    if (!Array.isArray(entries) || entries.length === 0) {
      fail(`${sourcesPath}: products.${id} must be a non-empty list of { "repo": ... } sources.`);
    }

    return {
      id,
      sources: entries.map((entry, index) => {
        if (typeof entry?.repo !== "string") {
          fail(`${sourcesPath}: products.${id}[${index}] needs a "repo" path.`);
        }

        const repo = resolve(root, entry.repo);

        if (!existsSync(resolve(repo, ".git"))) {
          fail(`${sourcesPath}: products.${id}[${index}].repo — ${repo} is not a git clone.`);
        }

        return { repo, paths: entry.paths ?? [], exclude: entry.exclude ?? [] };
      }),
    };
  });

  // Everything else: every clone under `dir` whose origin belongs to `owner`,
  // counting only the commits no product above has already claimed. New work
  // repositories land here without anyone editing this file.
  let rest = null;

  if (sources.rest !== undefined) {
    const { product: id, owner, dir = ".." } = sources.rest ?? {};

    if (typeof id !== "string" || typeof owner !== "string") {
      fail(`${sourcesPath}: "rest" needs a "product" id and a GitHub "owner".`);
    }

    if (products.some((product) => product.id === id)) {
      fail(`${sourcesPath}: rest.product "${id}" is also listed under "products".`);
    }

    const parent = resolve(root, dir);
    const origin = new RegExp(`github\\.com[:/]${owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`, "i");
    const repos = readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(resolve(parent, entry.name, ".git")))
      .map((entry) => resolve(parent, entry.name))
      .filter((repo) => repo !== root)
      .filter((repo) => {
        try {
          return origin.test(git(repo, ["remote", "get-url", "origin"]));
        } catch {
          return false;
        }
      });

    rest = { id, repos };
  }

  return { authors, products, rest };
}

/**
 * Your commits in one clone, optionally limited to a pathspec. `key` is the
 * author date plus subject: rebased and cherry-picked copies of one commit
 * keep both while getting a new hash on every branch --all walks.
 */
function commitsIn(repo, authors, pathspec = []) {
  const log = git(repo, [
    "log",
    "--all",
    "--no-merges",
    "--fixed-strings",
    "--regexp-ignore-case",
    ...authors.map((author) => `--author=${author}`),
    "--format=%H%x1f%aI%x1f%s",
    ...(pathspec.length ? ["--", ...pathspec] : []),
  ]);

  return log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, date, ...subject] = line.split("\x1f");

      return { hash, date, key: `${date}\x1f${subject.join("\x1f")}` };
    });
}

async function activity() {
  const { authors, products, rest } = loadSources();
  const repos = [
    ...new Set([...products.flatMap((product) => product.sources.map((source) => source.repo)), ...(rest?.repos ?? [])]),
  ];

  if (!flags.has("--no-fetch")) {
    for (const repo of repos) {
      process.stdout.write(`Fetching ${repo} … `);

      try {
        git(repo, ["fetch", "--all", "--prune", "--quiet"]);
        console.log("done");
      } catch (error) {
        // Offline, or credentials expired: local refs are still history, just
        // possibly behind. Worth saying, not worth stopping for.
        console.log(`\x1b[33mfailed, using local refs\x1b[0m (${String(error.stderr ?? error.message).trim()})`);
      }
    }
  }

  const generatedAt = new Date().toISOString();
  const weeksById = {};
  // Every commit some product has counted, by hash and by key, so the rest
  // product only ever gets what nothing else claimed.
  const claimedHashes = new Set();
  const claimedKeys = new Set();

  const tally = (counts, commit) => {
    const week = mondayOf(commit.date);
    counts.set(week, (counts.get(week) ?? 0) + 1);
  };

  const toWeeks = (counts) =>
    [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([week, commits]) => ({ week, commits }));

  for (const product of products) {
    const seen = new Set();
    const counts = new Map();

    for (const source of product.sources) {
      const pathspec = source.paths.length
        ? source.paths
        : source.exclude.length
          ? [".", ...source.exclude.map((path) => `:(exclude)${path}`)]
          : [];

      for (const commit of commitsIn(source.repo, authors, pathspec)) {
        claimedHashes.add(commit.hash);
        claimedKeys.add(commit.key);

        if (!seen.has(commit.key)) {
          seen.add(commit.key);
          tally(counts, commit);
        }
      }
    }

    weeksById[product.id] = toWeeks(counts);
  }

  if (rest) {
    const seen = new Set();
    const counts = new Map();

    for (const repo of rest.repos) {
      for (const commit of commitsIn(repo, authors)) {
        if (claimedHashes.has(commit.hash) || claimedKeys.has(commit.key) || seen.has(commit.key)) {
          continue;
        }

        seen.add(commit.key);
        tally(counts, commit);
      }
    }

    weeksById[rest.id] = toWeeks(counts);
  }

  const document = parseCareerActivity({ generatedAt, products: weeksById });

  console.log("");

  for (const [id, weeks] of Object.entries(document.products)) {
    const commits = weeks.reduce((sum, week) => sum + week.commits, 0);
    const range = weeks.length ? `${weeks[0].week} → ${weeks.at(-1).week}` : "no commits";
    console.log(`  ${id.padEnd(18)} ${String(commits).padStart(5)} commits  ${String(weeks.length).padStart(3)} weeks  ${range}`);
  }

  if (flags.has("--dry-run")) {
    console.log("\nDry run: nothing written.");
    return;
  }

  const store = openStore();
  await store.write(CAREER_ACTIVITY_KEY, document);
  console.log(`\nWrote ${CAREER_ACTIVITY_KEY} to ${store.location}`);

  // Activity joins content on the product id; a mismatch is a bar that never
  // appears, which is easier to spot here than on the page.
  const content = await store.read(CAREER_CONTENT_KEY);

  if (content === null) {
    console.log("\x1b[33mNo content is published there yet: run `npm run career -- push` too.\x1b[0m");
    return;
  }

  const published = new Set(parseCareerContent(content).jobs.flatMap((job) => job.products.map((product) => product.id)));

  for (const id of Object.keys(document.products)) {
    if (!published.has(id)) {
      console.log(`\x1b[33m"${id}" has activity but no product in the published content; it will not be shown.\x1b[0m`);
    }
  }

  for (const id of published) {
    if (!(id in document.products)) {
      console.log(`\x1b[33m"${id}" is a published product with no sources; its bar will be empty.\x1b[0m`);
    }
  }
}

async function push() {
  const content = parseCareerContent(readJsonFile(contentPath));

  // Every logo is read and checked before anything is written, so a missing
  // file cannot leave half a publish behind.
  const assets = logosOf(content).map((name) => {
    const path = resolve(assetsDir, name);

    if (!existsSync(path)) {
      fail(`${contentPath} names the logo "${name}", but ${path} does not exist.`);
    }

    const bytes = readFileSync(path);

    if (bytes.length > MAX_ASSET_BYTES) {
      fail(`${path} is ${Math.round(bytes.length / 1024)} KB; logos are limited to ${MAX_ASSET_BYTES / 1024} KB.`);
    }

    return { name, asset: { contentType: assetContentType(name), data: bytes.toString("base64") } };
  });

  const store = openStore();

  // Logos first: published content never names a logo that is not there yet.
  for (const { name, asset } of assets) {
    await store.write(careerAssetKey(name), asset);
  }

  await store.write(CAREER_CONTENT_KEY, content);

  const products = content.jobs.reduce((sum, job) => sum + job.products.length, 0);
  console.log(
    `Published ${content.jobs.length} job(s), ${products} product(s) and ${assets.length} logo(s) to ${store.location}`,
  );
}

async function pull() {
  const store = openStore();
  const content = await store.read(CAREER_CONTENT_KEY);

  if (content === null) {
    fail(`Nothing is published at ${store.location}/${CAREER_CONTENT_KEY}.`);
  }

  // Compared after validation, which normalises (trims, fills omitted fields
  // with null), so a file that was just pushed never reads as "changed".
  if (existsSync(contentPath) && !flags.has("--force")) {
    let local = null;

    try {
      local = JSON.stringify(parseCareerContent(JSON.parse(readFileSync(contentPath, "utf-8"))));
    } catch {
      // Unparseable or invalid local edits are still edits.
    }

    if (local !== JSON.stringify(content)) {
      fail(`${contentPath} has changes that are not published. Push them, or pass --force to discard them.`);
    }
  }

  mkdirSync(assetsDir, { recursive: true });

  for (const name of logosOf(content)) {
    const asset = await store.read(careerAssetKey(name));

    if (asset === null) {
      console.log(`\x1b[33mThe content names "${name}", but it was never uploaded.\x1b[0m`);
      continue;
    }

    writeFileSync(resolve(assetsDir, name), Buffer.from(asset.data, "base64"));
  }

  writeFileSync(contentPath, `${JSON.stringify(content, null, 2)}\n`, "utf-8");
  console.log(`Wrote ${contentPath} and ${assetsDir}`);
}

const commands = { activity, push, pull };

if (!(command in commands)) {
  fail("Usage: npm run career -- <activity|push|pull> [--local] [--no-fetch] [--dry-run] [--force]");
}

try {
  await commands[command]();
} catch (error) {
  if (error instanceof CareerDataError) {
    fail(`Invalid career data — ${error.message}`);
  }

  throw error;
}
