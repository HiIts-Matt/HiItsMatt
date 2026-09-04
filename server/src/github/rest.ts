import { env } from "../env.js";
import type { Profile, Repo } from "./types.js";

const API_BASE = "https://api.github.com";

// GitHub rejects API requests that carry no User-Agent with a 403.
const USER_AGENT = "hiitsmatt-portfolio-server";

const MAX_REPO_PAGES = 5;
const REPOS_PER_PAGE = 100;

/**
 * Status is a closed union of the four failures this server can honestly
 * report, so route handlers can hand it straight to `c.json` without casting:
 * 404 unknown resource, 429 rate limited, 502 upstream failure,
 * 503 capability unavailable (no token).
 */
export type GitHubErrorStatus = 404 | 429 | 502 | 503;

export class GitHubError extends Error {
  readonly status: GitHubErrorStatus;

  constructor(message: string, status: GitHubErrorStatus) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

type RequestOptions = {
  accept?: string;
  method?: "GET" | "POST";
  body?: unknown;
};

/**
 * Returns null for 404 so callers can treat "no such repo/readme" as data
 * instead of an error. Anything else non-OK throws: 429 when the rate limit is
 * the actual cause, 502 otherwise.
 */
async function request(path: string, options: RequestOptions = {}): Promise<Response | null> {
  const headers: Record<string, string> = {
    Accept: options.accept ?? "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
  };

  if (env.githubToken) {
    headers.Authorization = `Bearer ${env.githubToken}`;
  }

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (cause) {
    throw new GitHubError(
      `Could not reach the GitHub API (${path}): ${cause instanceof Error ? cause.message : String(cause)}`,
      502,
    );
  }

  if (response.ok) {
    return response;
  }

  const detail = (await response.text()).slice(0, 200);

  if (response.status === 404) {
    return null;
  }

  // 403 and 429 both mean "rate limited" only when the remaining budget is
  // actually zero; otherwise they are permission or abuse-detection failures.
  if (
    (response.status === 403 || response.status === 429) &&
    response.headers.get("x-ratelimit-remaining") === "0"
  ) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const resetAt =
      Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : "an unknown time";

    throw new GitHubError(
      `GitHub API rate limit exhausted; it resets at ${resetAt}.${env.githubToken ? "" : " Set GITHUB_TOKEN to raise the limit from 60 to 5000 requests per hour."}`,
      429,
    );
  }

  throw new GitHubError(
    `GitHub API request failed with ${response.status} for ${path}: ${detail}`,
    502,
  );
}

type RestProfile = {
  login: string;
  name: string | null;
  bio: string | null;
  avatar_url: string;
  html_url: string;
  company: string | null;
  location: string | null;
  blog: string | null;
  followers: number;
  following: number;
  public_repos: number;
  created_at: string;
};

type RestRepo = {
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  html_url: string;
  homepage: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  topics: string[] | null;
  pushed_at: string | null;
  updated_at: string;
  archived: boolean;
  fork: boolean;
  private: boolean;
};

export async function fetchProfile(login: string): Promise<Profile> {
  const response = await request(`/users/${encodeURIComponent(login)}`);

  if (!response) {
    throw new GitHubError(`GitHub user "${login}" does not exist.`, 404);
  }

  const raw = (await response.json()) as RestProfile;

  return {
    login: raw.login,
    name: raw.name,
    bio: raw.bio,
    avatarUrl: raw.avatar_url,
    htmlUrl: raw.html_url,
    company: raw.company,
    location: raw.location,
    blog: raw.blog && raw.blog.length > 0 ? raw.blog : null,
    followers: raw.followers,
    following: raw.following,
    publicRepos: raw.public_repos,
    createdAt: raw.created_at,
  };
}

export async function fetchOwnedPublicRepos(login: string): Promise<Omit<Repo, "readmeExcerpt">[]> {
  const repos: Omit<Repo, "readmeExcerpt">[] = [];

  // MAX_REPO_PAGES is a circuit breaker, not a real limit: 500 repos is far more
  // than the page shows and stops a paging bug from burning the rate limit.
  for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
    const response = await request(
      `/users/${encodeURIComponent(login)}/repos?per_page=${REPOS_PER_PAGE}&sort=pushed&type=owner&page=${page}`,
    );

    if (!response) {
      throw new GitHubError(`GitHub user "${login}" does not exist.`, 404);
    }

    const raw = (await response.json()) as RestRepo[];

    for (const repo of raw) {
      if (repo.fork || repo.private) {
        continue;
      }

      repos.push({
        name: repo.name,
        fullName: repo.full_name,
        owner: repo.owner.login,
        description: repo.description,
        htmlUrl: repo.html_url,
        homepage: repo.homepage && repo.homepage.length > 0 ? repo.homepage : null,
        language: repo.language,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        topics: repo.topics ?? [],
        // pushed_at is null for repos that never received a commit.
        pushedAt: repo.pushed_at ?? repo.updated_at,
        archived: repo.archived,
        // GitHub's own Open Graph renderer; produces the repo card image and
        // needs no authentication.
        socialImageUrl: `https://opengraph.githubassets.com/1/${repo.full_name}`,
      });
    }

    if (raw.length < REPOS_PER_PAGE) {
      break;
    }
  }

  repos.sort((a, b) => Date.parse(b.pushedAt) - Date.parse(a.pushedAt));

  return repos;
}

export async function fetchRepoLanguages(
  owner: string,
  repo: string,
): Promise<Record<string, number>> {
  const response = await request(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`,
  );

  // A repo that disappeared between listing and this call simply contributes
  // nothing to the aggregate.
  if (!response) {
    return {};
  }

  return (await response.json()) as Record<string, number>;
}

export async function fetchReadmeMarkdown(owner: string, repo: string): Promise<string | null> {
  const response = await request(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
    { accept: "application/vnd.github.raw" },
  );

  // 404 here is ordinary: plenty of repos have no README at all.
  if (!response) {
    return null;
  }

  return await response.text();
}

export async function renderMarkdown(markdown: string, context: string): Promise<string> {
  // GitHub's renderer returns sanitized HTML and resolves relative links and
  // issue references against `context`, which a local renderer cannot do.
  const response = await request("/markdown", {
    method: "POST",
    accept: "application/vnd.github+json",
    body: { text: markdown, mode: "gfm", context },
  });

  if (!response) {
    throw new GitHubError(`GitHub could not render markdown for "${context}".`, 502);
  }

  return await response.text();
}
