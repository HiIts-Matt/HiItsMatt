import type {
  ActivityWeek,
  CareerActivity,
  CareerContent,
  CareerJobContent,
  CareerProductContent,
} from "./schema.js";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Idle time that ends a period: four empty weeks, which is "a gap of a month
 * or more" at the weekly resolution the activity is published at.
 */
const PERIOD_GAP_MS = 28 * DAY_MS;

/**
 * A stretch of continuous work on one product. `start` is the Monday of its
 * first active week; `end` is the Monday after its last one (exclusive).
 *
 * `end` is null for a stretch still running when the activity was generated:
 * the page draws it up to today, so a single run keeps showing current work
 * until the next run replaces it with what actually happened.
 */
export type ActivityPeriod = { start: string; end: string | null };

export type CareerProduct = Omit<CareerProductContent, "logo"> & {
  /** Path of the logo on this API, or null when the product has none. */
  logoUrl: string | null;
  /** Active weeks inside the job's dates, oldest first. */
  weeks: ActivityWeek[];
  periods: ActivityPeriod[];
};

export type CareerJob = Omit<CareerJobContent, "products"> & { products: CareerProduct[] };

/** The `/api/career` payload. */
export type Career = {
  /** Newest first by start date, whatever order the content lists them in. */
  jobs: CareerJob[];
  /** When the activity was last generated; null if it never has been. */
  activityGeneratedAt: string | null;
};

const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function periodsOf(weeks: readonly ActivityWeek[], generatedAt: string, jobEnd: string | null): ActivityPeriod[] {
  const periods: ActivityPeriod[] = [];
  let start: number | null = null;
  let end = 0;

  for (const { week } of weeks) {
    const monday = toMs(week);

    if (start !== null && monday - end >= PERIOD_GAP_MS) {
      periods.push({ start: toDate(start), end: toDate(end) });
      start = null;
    }

    start ??= monday;
    end = monday + WEEK_MS;
  }

  if (start !== null) {
    const ongoing = Date.parse(generatedAt) - end < PERIOD_GAP_MS;
    periods.push({ start: toDate(start), end: ongoing ? null : toDate(end) });
  }

  if (!jobEnd) {
    return periods;
  }

  // Leaving closes everything still running on the last day.
  return periods.map((period) =>
    period.end === null || period.end > jobEnd ? { start: period.start, end: jobEnd } : period,
  );
}

export function buildCareer(content: CareerContent, activity: CareerActivity | null): Career {
  // ISO dates order correctly as strings.
  const jobs = [...content.jobs].sort((a, b) => b.start.localeCompare(a.start));

  return {
    jobs: jobs.map((job) => ({
      ...job,
      products: job.products.map(({ logo, ...product }) => {
        // Commits outside the job's dates belong to no bar on its axis.
        const weeks = (activity?.products[product.id] ?? []).filter(
          ({ week }) => toMs(week) + WEEK_MS > toMs(job.start) && (!job.end || week < job.end),
        );

        return {
          ...product,
          logoUrl: logo ? `/api/career/assets/${encodeURIComponent(logo)}` : null,
          weeks,
          periods: activity ? periodsOf(weeks, activity.generatedAt, job.end) : [],
        };
      }),
    })),
    activityGeneratedAt: activity?.generatedAt ?? null,
  };
}
