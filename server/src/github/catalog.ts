import { cached } from "../cache.js";
import { env } from "../env.js";
import { fetchContributions, type Contributions } from "./graphql.js";
import { readmeExcerpt } from "./markdown.js";
import {
  fetchOwnedPublicRepos,
  fetchProfile,
  fetchReadmeMarkdown,
  fetchRepoLanguages,
  GitHubError,
  renderMarkdown,
} from "./rest.js";
import type { LanguageStat, Profile, Repo } from "./types.js";

const METADATA_TTL_MS = 5 * 60 * 1000;
const CONTENT_TTL_MS = 15 * 60 * 1000;

// Unauthenticated GitHub allows 60 requests/hour per IP, and both the excerpt
// and the language passes cost one request per repo. Bounding the fan-out keeps
// a cold cache from spending the whole budget in one page load.
const ENRICHED_REPO_LIMIT = 24;

export function getProfile(): Promise<Profile> {
  return cached("profile", METADATA_TTL_MS, () => fetchProfile(env.githubUsername));
}

function getBaseRepos(): Promise<Omit<Repo, "readmeExcerpt">[]> {
  return cached("repos:base", METADATA_TTL_MS, () => fetchOwnedPublicRepos(env.githubUsername));
}

function getReadmeMarkdown(repo: Omit<Repo, "readmeExcerpt">): Promise<string | null> {
  return cached(`readme:${repo.fullName}`, CONTENT_TTL_MS, () =>
    fetchReadmeMarkdown(repo.owner, repo.name),
  );
}

export function getRepos(): Promise<Repo[]> {
  // Metadata TTL, not content TTL: stars and push dates should refresh on the
  // shorter clock, while the per-repo README entries stay cached for 15 min so
  // the refresh costs only the repo listing itself.
  return cached("repos", METADATA_TTL_MS, async () => {
    const base = await getBaseRepos();
    const enriched = base.slice(0, ENRICHED_REPO_LIMIT);

    const readmes = await Promise.allSettled(enriched.map((repo) => getReadmeMarkdown(repo)));

    return base.map((repo, index) => {
      const readme = readmes[index];
      const markdown = readme?.status === "fulfilled" ? readme.value : null;

      return {
        ...repo,
        // A README that fails to load only costs this one excerpt.
        readmeExcerpt: markdown ? readmeExcerpt(markdown) : null,
      };
    });
  });
}

export function getLanguages(): Promise<{ languages: LanguageStat[]; totalBytes: number }> {
  return cached("languages", CONTENT_TTL_MS, async () => {
    const base = await getBaseRepos();
    const sampled = base.slice(0, ENRICHED_REPO_LIMIT);

    const results = await Promise.allSettled(
      sampled.map((repo) =>
        cached(`languages:${repo.fullName}`, CONTENT_TTL_MS, () =>
          fetchRepoLanguages(repo.owner, repo.name),
        ),
      ),
    );

    const bytesByLanguage: Record<string, number> = {};
    let totalBytes = 0;

    for (const result of results) {
      if (result.status !== "fulfilled") {
        continue;
      }

      for (const [language, bytes] of Object.entries(result.value)) {
        bytesByLanguage[language] = (bytesByLanguage[language] ?? 0) + bytes;
        totalBytes += bytes;
      }
    }

    const languages: LanguageStat[] = Object.entries(bytesByLanguage)
      .map(([name, bytes]) => ({ name, bytes, share: totalBytes > 0 ? bytes / totalBytes : 0 }))
      .sort((a, b) => b.bytes - a.bytes);

    return { languages, totalBytes };
  });
}

export function getContributions(): Promise<Contributions> {
  return cached("contributions", METADATA_TTL_MS, () => fetchContributions(env.githubUsername));
}

export async function getReadmeHtml(repoName: string): Promise<string | null> {
  // Authorize against the published list first: without this the route would
  // happily render the README of any repo on GitHub.
  const repos = await getRepos();
  const match = repos.find((repo) => repo.name.toLowerCase() === repoName.toLowerCase());

  // A repo outside the published list is a 404, not an empty README: that keeps
  // `null` meaning exactly "this project has no README".
  if (!match) {
    throw new GitHubError(`"${repoName}" is not one of the published repositories.`, 404);
  }

  return cached(`readme-html:${match.fullName}`, CONTENT_TTL_MS, async () => {
    const markdown = await getReadmeMarkdown(match);

    if (markdown === null) {
      return null;
    }

    return await renderMarkdown(markdown, match.fullName);
  });
}
