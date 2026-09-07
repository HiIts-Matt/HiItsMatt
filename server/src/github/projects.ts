import { cached } from "../cache.js";
import { env } from "../env.js";
import { getReadmeMarkdown } from "./catalog.js";
import { readmeExcerpt } from "./markdown.js";
import { fetchRepo, fetchRepoDirectory, fetchRepoFile, GitHubError } from "./rest.js";
import type { Project, ProjectLink, ProjectMedia, ProjectMediaKind } from "./types.js";

/**
 * The curated projects page: the repositories named in PROJECT_REPOS, public or
 * private, described by a convention that lives inside each repository rather
 * than by GitHub metadata alone.
 *
 *   .portfolio/
 *     project.json      optional metadata (see `Manifest` below)
 *     media/            images and videos, shown in filename order
 *       01-hero.png
 *       02-tour.mp4
 *       shots/          one level of grouping folders is also read
 *
 * Everything is optional. A whitelisted repo with no `.portfolio` directory
 * still appears, described by its GitHub description or README excerpt, which
 * is what lets a project be published before its assets exist.
 *
 * Media is never linked to GitHub directly: raw URLs for a private repository
 * require credentials, so every asset is streamed back through
 * `openProjectMedia` and addressed by a path this server published itself.
 */
const PORTFOLIO_ROOT = ".portfolio";
const MANIFEST_PATH = `${PORTFOLIO_ROOT}/project.json`;
const MEDIA_ROOT = `${PORTFOLIO_ROOT}/media`;

const METADATA_TTL_MS = 5 * 60 * 1000;
const CONTENT_TTL_MS = 15 * 60 * 1000;

/** `media/` itself plus one level of grouping folders inside it. */
const MEDIA_DEPTH = 2;
const MAX_MEDIA_FILES = 24;
/**
 * Assets stream through this process, so a huge file occupies a connection for
 * as long as it takes to arrive. Anything this large belongs on a CDN.
 */
const MAX_MEDIA_BYTES = 40 * 1024 * 1024;

/**
 * The extension is the whole allowlist: it decides both what discovery picks up
 * and what the proxy is willing to serve, so nothing else in a repository —
 * source, secrets, dotfiles — can ever be addressed through it.
 */
const MEDIA_TYPES: Record<string, { kind: ProjectMediaKind; contentType: string }> = {
  ".png": { kind: "image", contentType: "image/png" },
  ".jpg": { kind: "image", contentType: "image/jpeg" },
  ".jpeg": { kind: "image", contentType: "image/jpeg" },
  ".gif": { kind: "image", contentType: "image/gif" },
  ".webp": { kind: "image", contentType: "image/webp" },
  ".avif": { kind: "image", contentType: "image/avif" },
  ".svg": { kind: "image", contentType: "image/svg+xml" },
  ".mp4": { kind: "video", contentType: "video/mp4" },
  ".webm": { kind: "video", contentType: "video/webm" },
  ".mov": { kind: "video", contentType: "video/quicktime" },
  ".ogv": { kind: "video", contentType: "video/ogg" },
};

function mediaTypeFor(path: string): { kind: ProjectMediaKind; contentType: string } | undefined {
  const dot = path.lastIndexOf(".");

  return dot === -1 ? undefined : MEDIA_TYPES[path.slice(dot).toLowerCase()];
}

/**
 * `.portfolio/project.json`. Every field is optional and anything unrecognised
 * is ignored: a malformed manifest degrades the project to its GitHub metadata
 * instead of removing it from the page.
 *
 * `media` paths are relative to `.portfolio/` (`media/01-hero.png`). Declaring
 * `media` makes it authoritative for both order and captions, and files it does
 * not name are left out.
 */
type Manifest = {
  title?: string;
  tagline?: string;
  summary?: string;
  year?: string;
  status?: string;
  tags?: string[];
  links?: ProjectLink[];
  /** Moved to the front of `media`; the client leads with it. */
  cover?: string;
  media?: { src: string; alt?: string; caption?: string; poster?: string }[];
};

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function parseManifest(json: string, fullName: string): Manifest {
  let raw: unknown;

  try {
    raw = JSON.parse(json);
  } catch (cause) {
    console.warn(
      `Ignoring ${fullName}/${MANIFEST_PATH}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );

    return {};
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }

  const source = raw as Record<string, unknown>;
  const manifest: Manifest = {
    title: readString(source.title),
    tagline: readString(source.tagline),
    summary: readString(source.summary),
    year: readString(source.year) ?? (typeof source.year === "number" ? String(source.year) : undefined),
    status: readString(source.status),
    cover: readString(source.cover),
  };

  if (Array.isArray(source.tags)) {
    const tags = source.tags.map(readString).filter((tag): tag is string => tag !== undefined);

    if (tags.length > 0) {
      manifest.tags = tags;
    }
  }

  if (Array.isArray(source.links)) {
    const links: ProjectLink[] = [];

    for (const entry of source.links) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }

      const candidate = entry as Record<string, unknown>;
      const url = readString(candidate.url);
      const label = readString(candidate.label);

      // Only absolute web links: a relative href would resolve against this
      // site and quietly point at nothing.
      if (!url || !label || !/^https?:\/\//i.test(url)) {
        continue;
      }

      links.push({ label, url });
    }

    if (links.length > 0) {
      manifest.links = links;
    }
  }

  if (Array.isArray(source.media)) {
    const media: NonNullable<Manifest["media"]> = [];

    for (const entry of source.media) {
      // Shorthand: a bare string is a path with no caption.
      if (typeof entry === "string") {
        const src = readString(entry);

        if (src) {
          media.push({ src });
        }

        continue;
      }

      if (typeof entry !== "object" || entry === null) {
        continue;
      }

      const candidate = entry as Record<string, unknown>;
      const src = readString(candidate.src);

      if (!src) {
        continue;
      }

      media.push({
        src,
        alt: readString(candidate.alt),
        caption: readString(candidate.caption),
        poster: readString(candidate.poster),
      });
    }

    if (media.length > 0) {
      manifest.media = media;
    }
  }

  return manifest;
}

/**
 * Every media file under `.portfolio/media`, keyed by its path relative to
 * `.portfolio/`. Breadth-first with a depth cap so a stray deep tree cannot turn
 * one project into dozens of API calls.
 */
async function discoverMedia(owner: string, name: string): Promise<string[]> {
  const files: { path: string; size: number }[] = [];
  let level = [MEDIA_ROOT];

  for (let depth = 0; depth < MEDIA_DEPTH && level.length > 0; depth += 1) {
    const listings = await Promise.all(
      level.map((path) => fetchRepoDirectory(owner, name, path)),
    );
    const next: string[] = [];

    for (const listing of listings) {
      if (!listing) {
        continue;
      }

      for (const entry of listing) {
        if (entry.type === "dir") {
          next.push(entry.path);
          continue;
        }

        if (!mediaTypeFor(entry.path)) {
          continue;
        }

        if (entry.size > MAX_MEDIA_BYTES) {
          console.warn(
            `Skipping ${owner}/${name}/${entry.path}: ${Math.round(entry.size / 1024 / 1024)} MB exceeds the ${MAX_MEDIA_BYTES / 1024 / 1024} MB asset limit.`,
          );
          continue;
        }

        files.push({ path: entry.path, size: entry.size });
      }
    }

    level = next;
  }

  // Numeric collation is what makes `10-*` sort after `2-*`, which is the
  // ordering anyone naming files expects.
  files.sort((a, b) => a.path.localeCompare(b.path, "en", { numeric: true }));

  return files
    .slice(0, MAX_MEDIA_FILES)
    .map((file) => file.path.slice(PORTFOLIO_ROOT.length + 1));
}

/** Path relative to `.portfolio/`, as the manifest and the proxy both spell it. */
function resolveAssetPath(candidate: string, available: readonly string[]): string | undefined {
  const cleaned = candidate.trim().replace(/^\.?\//, "");
  const lower = cleaned.toLowerCase();

  return (
    available.find((path) => path.toLowerCase() === lower) ??
    // Forgiving on the one prefix everybody forgets.
    available.find((path) => path.toLowerCase() === `media/${lower}`)
  );
}

type ProjectAssets = {
  owner: string;
  name: string;
  /** Paths the proxy will serve, relative to `.portfolio/`. */
  paths: readonly string[];
};

type ProjectIndex = {
  projects: Project[];
  assets: Record<string, ProjectAssets>;
};

async function buildProject(
  owner: string,
  name: string,
): Promise<{ project: Project; assets: ProjectAssets } | null> {
  const fullName = `${owner}/${name}`;
  const repo = await cached(`project-repo:${fullName}`, METADATA_TTL_MS, () =>
    fetchRepo(owner, name),
  );

  if (!repo) {
    console.warn(
      `PROJECT_REPOS names ${fullName}, which this server cannot see. A private repository needs a GITHUB_TOKEN with repo scope.`,
    );

    return null;
  }

  const [manifestJson, available] = await Promise.all([
    cached(`project-manifest:${fullName}`, CONTENT_TTL_MS, async () => {
      const response = await fetchRepoFile(owner, name, MANIFEST_PATH);

      return response ? await response.text() : null;
    }),
    cached(`project-media:${fullName}`, CONTENT_TTL_MS, () => discoverMedia(owner, name)),
  ]);

  const manifest = manifestJson ? parseManifest(manifestJson, fullName) : {};
  const slug = repo.name.toLowerCase();
  const mediaBase = `/api/github/projects/${encodeURIComponent(slug)}/media`;
  const mediaUrl = (path: string) =>
    `${mediaBase}/${path.split("/").map(encodeURIComponent).join("/")}`;

  const declared = manifest.media?.flatMap((entry) => {
    const path = resolveAssetPath(entry.src, available);

    // A path the repo does not contain is a typo in the manifest, not a reason
    // to publish a broken <img>.
    if (!path) {
      console.warn(`${fullName}/${MANIFEST_PATH} names "${entry.src}", which is not in ${MEDIA_ROOT}.`);

      return [];
    }

    const poster = entry.poster ? resolveAssetPath(entry.poster, available) : undefined;

    return [
      {
        path,
        alt: entry.alt ?? null,
        caption: entry.caption ?? null,
        posterUrl: poster ? mediaUrl(poster) : null,
      },
    ];
  });

  const ordered = declared ?? available.map((path) => ({ path, alt: null, caption: null, posterUrl: null }));

  const cover = manifest.cover ? resolveAssetPath(manifest.cover, available) : undefined;

  if (cover) {
    const index = ordered.findIndex((entry) => entry.path === cover);

    if (index > 0) {
      ordered.unshift(...ordered.splice(index, 1));
    } else if (index === -1) {
      ordered.unshift({ path: cover, alt: null, caption: null, posterUrl: null });
    }
  }

  const media: ProjectMedia[] = ordered.map((entry) => ({
    // Discovery only keeps known extensions, so this lookup always resolves.
    kind: mediaTypeFor(entry.path)?.kind ?? "image",
    url: mediaUrl(entry.path),
    posterUrl: entry.posterUrl,
    alt: entry.alt,
    caption: entry.caption,
  }));

  let summary = manifest.summary ?? repo.description;

  if (!summary) {
    // Last resort, and one extra request: the README's first real paragraph.
    const markdown = await getReadmeMarkdown(owner, name);
    summary = markdown ? readmeExcerpt(markdown) : null;
  }

  const project: Project = {
    slug,
    title: manifest.title ?? repo.name,
    tagline: manifest.tagline ?? null,
    summary: summary ?? null,
    year: manifest.year ?? null,
    status: manifest.status ?? null,
    tags: manifest.tags ?? repo.topics,
    language: repo.language,
    stars: repo.stars,
    pushedAt: repo.pushedAt,
    isPrivate: repo.isPrivate,
    htmlUrl: repo.isPrivate ? null : repo.htmlUrl,
    homepage: repo.homepage,
    links: manifest.links ?? [],
    media,
  };

  return {
    project,
    // Posters are addressable too, even when no media entry lists them first.
    assets: { owner, name, paths: available },
  };
}

/**
 * Whitelist order is display order, so the index is built in sequence rather
 * than sorted afterwards. A repository that fails to load is dropped with a
 * warning: one unreachable project must not blank the whole page.
 */
function getProjectIndex(): Promise<ProjectIndex> {
  return cached("projects", CONTENT_TTL_MS, async () => {
    const built = await Promise.allSettled(
      env.projectRepos.map((target) => buildProject(target.owner, target.name)),
    );

    const index: ProjectIndex = { projects: [], assets: {} };

    for (const [position, result] of built.entries()) {
      const target = env.projectRepos[position];

      if (result.status === "rejected") {
        console.warn(
          `Could not build the project for ${target?.owner}/${target?.name}:`,
          result.reason,
        );
        continue;
      }

      if (!result.value) {
        continue;
      }

      index.projects.push(result.value.project);
      index.assets[result.value.project.slug] = result.value.assets;
    }

    return index;
  });
}

export async function getProjects(): Promise<Project[]> {
  return (await getProjectIndex()).projects;
}

export type ProjectMediaStream = {
  status: 200 | 206;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
};

/**
 * Streams one whitelisted asset. `path` is checked against the paths discovered
 * for that project — that membership test, not any string sanitising, is what
 * stops this route from reading anything else out of a private repository.
 */
export async function openProjectMedia(
  slug: string,
  path: string,
  range: string | undefined,
): Promise<ProjectMediaStream> {
  const index = await getProjectIndex();
  const assets = index.assets[slug.toLowerCase()];

  if (!assets) {
    throw new GitHubError(`"${slug}" is not one of the published projects.`, 404);
  }

  // Exact membership in the discovered set is the whole authorization check.
  const type = assets.paths.includes(path) ? mediaTypeFor(path) : undefined;

  if (!type) {
    throw new GitHubError(`"${path}" is not a published asset of "${slug}".`, 404);
  }

  const upstream = await fetchRepoFile(
    assets.owner,
    assets.name,
    `${PORTFOLIO_ROOT}/${path}`,
    range,
  );

  if (!upstream) {
    throw new GitHubError(`"${path}" no longer exists in ${assets.owner}/${assets.name}.`, 404);
  }

  const headers: Record<string, string> = {
    "Content-Type": type.contentType,
    // The asset is as public as the page that shows it, and repo content at a
    // fixed path changes rarely.
    "Cache-Control": "public, max-age=3600",
    // Repo-supplied bytes: pin the type this server chose from the extension,
    // and make sure an SVG opened directly can still not run anything.
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  };

  const passthrough = ["content-length", "content-range", "accept-ranges", "etag", "last-modified"];

  for (const header of passthrough) {
    const value = upstream.headers.get(header);

    if (value) {
      headers[header] = value;
    }
  }

  return {
    // GitHub answers 206 only when it honours the Range; a 200 here means the
    // browser gets the whole file and seeks locally.
    status: upstream.status === 206 ? 206 : 200,
    headers,
    body: upstream.body,
  };
}
