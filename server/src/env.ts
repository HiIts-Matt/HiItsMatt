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

// A whitelist entry is `repo` (owned by `defaultOwner`) or `owner/repo`. Order
// is meaningful: it is the order the projects page renders them in.
function parseProjectRepos(
  raw: string | undefined,
  defaultOwner: string,
): { owner: string; name: string }[] {
  const seen = new Set<string>();
  const targets: { owner: string; name: string }[] = [];

  for (const entry of (raw ?? "").split(",")) {
    const trimmed = entry.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const parts = trimmed.split("/");
    const owner = parts.length === 2 ? (parts[0] ?? "") : defaultOwner;
    const name = parts.length === 2 ? (parts[1] ?? "") : trimmed;

    // A typo here is silent otherwise: the repo simply never appears, which
    // looks identical to a permissions problem. Refuse to boot instead.
    if (parts.length > 2 || !REPO_SEGMENT.test(owner) || !REPO_SEGMENT.test(name)) {
      throw new Error(
        `PROJECT_REPOS entry "${trimmed}" is not a repository: use "repo" or "owner/repo".`,
      );
    }

    const key = `${owner}/${name}`.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    targets.push({ owner, name });
  }

  // A list this long is a mistake, not a portfolio.
  if (targets.length > MAX_PROJECT_REPOS) {
    throw new Error(
      `PROJECT_REPOS lists ${targets.length} repositories; ${MAX_PROJECT_REPOS} is the maximum.`,
    );
  }

  return targets;
}

const projectRepos = parseProjectRepos(process.env.PROJECT_REPOS, githubUsername);

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
  projectRepos: Object.freeze(projectRepos) as readonly { owner: string; name: string }[],
  corsOrigins,
  port: Number(process.env.PORT ?? 3000),
});
