export type Profile = {
  login: string;
  name: string | null;
  bio: string | null;
  avatarUrl: string;
  htmlUrl: string;
  company: string | null;
  location: string | null;
  blog: string | null;
  followers: number;
  following: number;
  publicRepos: number;
  createdAt: string;
};

export type LanguageStat = {
  name: string;
  bytes: number;
  /** Fraction of `totalBytes`, 0..1. Stats arrive sorted descending. */
  share: number;
};

export type ContributionDay = {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export type ContributionWeek = {
  days: ContributionDay[];
};

export type Repo = {
  name: string;
  fullName: string;
  owner: string;
  description: string | null;
  htmlUrl: string;
  homepage: string | null;
  language: string | null;
  stars: number;
  forks: number;
  topics: string[];
  pushedAt: string;
  archived: boolean;
  socialImageUrl: string;
  readmeExcerpt: string | null;
};

export type ProjectMediaKind = "image" | "video";

export type ProjectMedia = {
  kind: ProjectMediaKind;
  /**
   * Path on this server, not on GitHub: assets are proxied so a private
   * repository's media works in the browser without exposing a token.
   */
  url: string;
  /** Video poster frame; only set when the manifest names one. */
  posterUrl: string | null;
  alt: string | null;
  caption: string | null;
};

export type ProjectLink = {
  label: string;
  url: string;
};

/**
 * A whitelisted repository (PROJECT_REPOS) presented as a case study. Every
 * field beyond `slug`/`title` is optional in the source repo: the metadata
 * falls back to GitHub's own description, and `media` is empty until the repo
 * grows a `.portfolio/media` directory.
 */
export type Project = {
  /** Lowercased repo name; the media proxy addresses projects by this. */
  slug: string;
  title: string;
  tagline: string | null;
  summary: string | null;
  year: string | null;
  status: string | null;
  tags: string[];
  language: string | null;
  stars: number;
  pushedAt: string;
  isPrivate: boolean;
  /** null for private repos, where the link would 404 for every visitor. */
  htmlUrl: string | null;
  homepage: string | null;
  links: ProjectLink[];
  /** Cover first; the client leads with `media[0]`. */
  media: ProjectMedia[];
};
