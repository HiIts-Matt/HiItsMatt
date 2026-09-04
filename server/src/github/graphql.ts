import { env } from "../env.js";
import { GitHubError } from "./rest.js";
import type { ContributionDay, ContributionWeek } from "./types.js";

const GRAPHQL_URL = "https://api.github.com/graphql";

const CONTRIBUTIONS_QUERY = `query Contributions($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
          }
        }
      }
    }
  }
}`;

type ContributionLevel =
  | "NONE"
  | "FIRST_QUARTILE"
  | "SECOND_QUARTILE"
  | "THIRD_QUARTILE"
  | "FOURTH_QUARTILE";

// Keyed loosely on purpose: an unknown level from a future API revision falls
// back to 0 instead of producing `undefined` in the response.
const LEVEL_BY_NAME: Record<string, ContributionDay["level"]> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

type GraphQLResponse = {
  data: {
    user: {
      contributionsCollection: {
        contributionCalendar: {
          totalContributions: number;
          weeks: {
            contributionDays: {
              date: string;
              contributionCount: number;
              contributionLevel: ContributionLevel;
            }[];
          }[];
        };
      };
    } | null;
  } | null;
  errors?: { message: string }[];
};

export type Contributions = {
  total: number;
  from: string;
  to: string;
  weeks: ContributionWeek[];
};

export async function fetchContributions(login: string): Promise<Contributions> {
  if (!env.githubToken) {
    throw new GitHubError(
      "Contribution graph requires GITHUB_TOKEN (GitHub's GraphQL API rejects unauthenticated requests)",
      503,
    );
  }

  let response: Response;

  try {
    response = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.githubToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "hiitsmatt-portfolio-server",
      },
      body: JSON.stringify({ query: CONTRIBUTIONS_QUERY, variables: { login } }),
    });
  } catch (cause) {
    throw new GitHubError(
      `Could not reach the GitHub GraphQL API: ${cause instanceof Error ? cause.message : String(cause)}`,
      502,
    );
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);

    if (response.status === 401) {
      throw new GitHubError(
        "GitHub rejected GITHUB_TOKEN; the contribution graph needs a valid token.",
        503,
      );
    }

    if (response.status === 403 || response.status === 429) {
      throw new GitHubError("GitHub GraphQL rate limit exhausted; try again later.", 429);
    }

    throw new GitHubError(
      `GitHub GraphQL request failed with ${response.status}: ${detail}`,
      502,
    );
  }

  const payload = (await response.json()) as GraphQLResponse;

  // GraphQL reports failures as HTTP 200 with an `errors` array, so an OK
  // status is not enough to trust `data`.
  if (payload.errors && payload.errors.length > 0) {
    throw new GitHubError(
      `GitHub GraphQL returned errors: ${payload.errors.map((error) => error.message).join("; ")}`,
      502,
    );
  }

  const user = payload.data?.user;

  if (!user) {
    throw new GitHubError(`GitHub user "${login}" has no contribution calendar.`, 404);
  }

  const calendar = user.contributionsCollection.contributionCalendar;

  const weeks: ContributionWeek[] = calendar.weeks.map((week) => ({
    days: week.contributionDays.map((day) => ({
      date: day.date,
      count: day.contributionCount,
      level: LEVEL_BY_NAME[day.contributionLevel] ?? 0,
    })),
  }));

  const days = weeks.flatMap((week) => week.days);
  const from = days.at(0)?.date ?? "";
  const to = days.at(-1)?.date ?? "";

  return { total: calendar.totalContributions, from, to, weeks };
}
