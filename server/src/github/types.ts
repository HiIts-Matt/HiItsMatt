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
