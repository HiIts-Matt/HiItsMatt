import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Resolved relative to this module so it works from both `src` (tsx) and `dist`
// (compiled) — both live exactly one level below the package root.
const envFile = fileURLToPath(new URL("../.env", import.meta.url));

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const githubUsername = process.env.GITHUB_USERNAME?.trim();

if (!githubUsername) {
  throw new Error(
    "GITHUB_USERNAME is required: set it in server/.env (see server/.env.example) or in the environment.",
  );
}

const githubToken = process.env.GITHUB_TOKEN?.trim();

/** GitHub owner/repo names accept these characters and nothing else. */
const REPO_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Each project costs a few GitHub requests per cache window; bound the fan-out. */
const MAX_PROJECT_REPOS = 24;

export type ProjectTarget = { owner: string; name: string };

/**
 * One slot on the projects page: a single repository, or a titled group that
 * renders as one card and opens into its members.
 */
export type ProjectEntryTarget =
  | { kind: "repo"; repo: ProjectTarget }
  | { kind: "group"; title: string; repos: ProjectTarget[] };

/**
 * Commas separate slots, except inside brackets: `[Title: a, b, c]` is one
 * group. Order is meaningful — it is the order the page renders slots in.
 */
function splitEntries(raw: string): string[] {
  const entries: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of raw) {
    if (char === "[") depth += 1;
    else if (char === "]") depth -= 1;

    if (char === "," && depth === 0) {
      entries.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  entries.push(current);

  if (depth !== 0) {
    throw new Error('PROJECT_REPOS has an unbalanced bracket: a group is written "[Title: repo, repo]".');
  }

  return entries;
}

// A repository is `repo` (owned by `defaultOwner`) or `owner/repo`.
function parseTarget(raw: string, defaultOwner: string): ProjectTarget {
  const parts = raw.split("/");
  const owner = parts.length === 2 ? (parts[0]?.trim() ?? "") : defaultOwner;
  const name = (parts.length === 2 ? (parts[1] ?? "") : raw).trim();

  // A typo here is silent otherwise: the repo simply never appears, which
  // looks identical to a permissions problem. Refuse to boot instead.
  if (parts.length > 2 || !REPO_SEGMENT.test(owner) || !REPO_SEGMENT.test(name)) {
    throw new Error(
      `PROJECT_REPOS entry "${raw.trim()}" is not a repository: use "repo" or "owner/repo".`,
    );
  }

  return { owner, name };
}

function parseProjectEntries(raw: string | undefined, defaultOwner: string): ProjectEntryTarget[] {
  const seen = new Set<string>();
  const entries: ProjectEntryTarget[] = [];
  let repoCount = 0;

  const take = (target: ProjectTarget): boolean => {
    const key = `${target.owner}/${target.name}`.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    repoCount += 1;

    return true;
  };

  for (const entry of splitEntries(raw ?? "")) {
    const trimmed = entry.trim();

    if (trimmed.length === 0) {
      continue;
    }

    if (!trimmed.startsWith("[")) {
      const target = parseTarget(trimmed, defaultOwner);

      if (take(target)) {
        entries.push({ kind: "repo", repo: target });
      }

      continue;
    }

    if (!trimmed.endsWith("]")) {
      throw new Error(`PROJECT_REPOS group "${trimmed}" is missing its closing bracket.`);
    }

    const inner = trimmed.slice(1, -1);
    const separator = inner.indexOf(":");

    if (separator === -1) {
      throw new Error(
        `PROJECT_REPOS group "${trimmed}" has no title: write "[Raspberry Pi: repo, repo]".`,
      );
    }

    const title = inner.slice(0, separator).trim();
    const repos = inner
      .slice(separator + 1)
      .split(",")
      .map((member) => member.trim())
      .filter((member) => member.length > 0)
      .map((member) => parseTarget(member, defaultOwner))
      .filter(take);

    if (title.length === 0 || repos.length === 0) {
      throw new Error(
        `PROJECT_REPOS group "${trimmed}" needs a title and at least one repository.`,
      );
    }

    entries.push({ kind: "group", title, repos });
  }

  // A list this long is a mistake, not a portfolio.
  if (repoCount > MAX_PROJECT_REPOS) {
    throw new Error(
      `PROJECT_REPOS lists ${repoCount} repositories; ${MAX_PROJECT_REPOS} is the maximum.`,
    );
  }

  return entries;
}

const projectEntries = parseProjectEntries(process.env.PROJECT_REPOS, githubUsername);

const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

export const env = Object.freeze({
  githubUsername,
  // Optional on purpose: the server boots without it and only the contribution
  // graph is unavailable (GraphQL requires auth), everything else degrades to
  // GitHub's 60 req/hour unauthenticated limit.
  githubToken: githubToken || undefined,
  // The curated projects page: empty means the page honestly says there is
  // nothing to show yet. Private entries need a token that can read them.
  projectEntries: Object.freeze(projectEntries) as readonly ProjectEntryTarget[],
  corsOrigins,
  port: Number(process.env.PORT ?? 3000),
});
