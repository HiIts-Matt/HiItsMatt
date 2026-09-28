/**
 * The career documents in the data store, and the validation both the server
 * and `scripts/career.js` run on them. Nothing here imports the server's
 * environment, so the CLI can load it without a GITHUB_USERNAME.
 *
 *   career/content.json   hand-written: jobs and their products. Edited
 *                         locally and published with `npm run career -- push`.
 *   career/activity.json  generated: weekly commit counts per product, written
 *                         by `npm run career -- activity` from local git history.
 *   career/assets/<name>  product logos, uploaded by `push` alongside the
 *                         content that names them.
 *
 * Everything the page shows lives here, logos included, so a new employer is
 * a push and never a deploy.
 *
 * Content and activity meet on the product `id`. Neither document is ever
 * written by the other's command, so regenerating activity cannot clobber an
 * edit and an edit cannot clobber activity.
 */

export const CAREER_CONTENT_KEY = "career/content.json";
export const CAREER_ACTIVITY_KEY = "career/activity.json";

/** Store key for a logo named in the content. */
export const careerAssetKey = (name: string) => `career/assets/${name}.json`;

/** Logo formats, by extension. SVG is served sandboxed. */
export const ASSET_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** A logo is a small image; anything larger is a mistake worth stopping. */
export const MAX_ASSET_BYTES = 512 * 1024;

/**
 * A logo as stored: the JSON store holds documents, so the bytes travel as
 * base64. Logos are a few KB, which makes the inflation irrelevant.
 */
export type CareerAsset = { contentType: string; data: string };

export type CareerProductContent = {
  /** Joins the product to its activity; lowercase, digits and dashes. */
  id: string;
  name: string;
  description: string | null;
  /** File name of a logo in `.career/assets/` (`fraudx.png`), published with the content. */
  logo: string | null;
  /** `#rrggbb`: the product's bar and accent colour. */
  color: string;
  /** Short figures shown as chips, e.g. "~40% of app code". */
  stats: string[];
  highlights: string[];
  /**
   * Whether the product gets a card under the timeline. False for a row that
   * only belongs on the timeline, such as a catch-all "Other projects".
   */
  card: boolean;
};

export type CareerJobContent = {
  company: string;
  url: string | null;
  location: string | null;
  role: string;
  /** YYYY-MM-DD. The timeline's axis starts here. */
  start: string;
  /**
   * YYYY-MM-DD, or null while the job is current. Setting it ends the axis and
   * every bar still running at that date.
   */
  end: string | null;
  summary: string | null;
  products: CareerProductContent[];
};

export type CareerContent = {
  /** Any number of jobs; the page shows them newest first by start date. */
  jobs: CareerJobContent[];
};

/** One week with at least one commit. `week` is that week's Monday, YYYY-MM-DD. */
export type ActivityWeek = { week: string; commits: number };

export type CareerActivity = {
  /** ISO timestamp of the run: the moment the data is accurate up to. */
  generatedAt: string;
  /** Product id → its active weeks, oldest first. */
  products: Record<string, ActivityWeek[]>;
};

export class CareerDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CareerDataError";
  }
}

type Path = string;

function fail(path: Path, message: string): never {
  throw new CareerDataError(`${path}: ${message}`);
}

/**
 * A plain object carrying only `allowed` keys (any keys when null). Unknown
 * keys are rejected rather than ignored: this document is typed by hand, and a
 * misspelt "hilights" should fail the push instead of silently dropping a list
 * from the page.
 */
function record(value: unknown, path: Path, allowed: readonly string[] | null): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected an object");
  }

  if (allowed) {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        fail(path, `unknown field "${key}" (expected one of: ${allowed.join(", ")})`);
      }
    }
  }

  return value as Record<string, unknown>;
}

function text(value: unknown, path: Path): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(path, "expected a non-empty string");
  }

  return value.trim();
}

function optionalText(value: unknown, path: Path): string | null {
  return value === undefined || value === null ? null : text(value, path);
}

function list<T>(value: unknown, path: Path, item: (value: unknown, path: Path) => T): T[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    fail(path, "expected an array");
  }

  return value.map((entry, index) => item(entry, `${path}[${index}]`));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date: `2026-02-30` matches the pattern and is still wrong. */
function date(value: unknown, path: Path): string {
  const raw = text(value, path);

  if (!DATE.test(raw) || new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw) {
    fail(path, `expected a date as YYYY-MM-DD, got "${raw}"`);
  }

  return raw;
}

const PRODUCT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const ASSET_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.([a-z]+)$/;

/** Validates a logo's file name and returns its content type. */
export function assetContentType(name: string): string {
  const extension = ASSET_NAME.exec(name)?.[1];
  const type = extension ? ASSET_CONTENT_TYPES[extension] : undefined;

  if (!type) {
    throw new CareerDataError(
      `"${name}" is not a valid logo name: lowercase letters, digits and dashes, ending in .${Object.keys(ASSET_CONTENT_TYPES).join(", .")}`,
    );
  }

  return type;
}

function product(value: unknown, path: Path): CareerProductContent {
  const raw = record(value, path, [
    "id",
    "name",
    "description",
    "logo",
    "color",
    "stats",
    "highlights",
    "card",
  ]);

  const id = text(raw.id, `${path}.id`);

  if (!PRODUCT_ID.test(id)) {
    fail(`${path}.id`, `"${id}" must be lowercase letters, digits and single dashes`);
  }

  const logo = optionalText(raw.logo, `${path}.logo`);

  if (logo) {
    try {
      assetContentType(logo);
    } catch (error) {
      fail(`${path}.logo`, (error as Error).message);
    }
  }

  const color = text(raw.color, `${path}.color`);

  if (!COLOR.test(color)) {
    fail(`${path}.color`, `expected #rrggbb, got "${color}"`);
  }

  if (raw.card !== undefined && typeof raw.card !== "boolean") {
    fail(`${path}.card`, "expected true or false");
  }

  return {
    id,
    name: text(raw.name, `${path}.name`),
    description: optionalText(raw.description, `${path}.description`),
    logo,
    color: color.toLowerCase(),
    stats: list(raw.stats, `${path}.stats`, text),
    highlights: list(raw.highlights, `${path}.highlights`, text),
    card: raw.card ?? true,
  };
}

function job(value: unknown, path: Path): CareerJobContent {
  const raw = record(value, path, [
    "company",
    "url",
    "location",
    "role",
    "start",
    "end",
    "summary",
    "products",
  ]);

  const url = optionalText(raw.url, `${path}.url`);

  if (url && !url.startsWith("https://")) {
    fail(`${path}.url`, "expected an https:// URL");
  }

  const start = date(raw.start, `${path}.start`);
  const end = raw.end === undefined || raw.end === null ? null : date(raw.end, `${path}.end`);

  // Same-format ISO dates order correctly as strings.
  if (end && end <= start) {
    fail(`${path}.end`, `${end} is not after the start date ${start}`);
  }

  return {
    company: text(raw.company, `${path}.company`),
    url,
    location: optionalText(raw.location, `${path}.location`),
    role: text(raw.role, `${path}.role`),
    start,
    end,
    summary: optionalText(raw.summary, `${path}.summary`),
    products: list(raw.products, `${path}.products`, product),
  };
}

export function parseCareerContent(value: unknown): CareerContent {
  const raw = record(value, "content", ["jobs"]);

  const content: CareerContent = { jobs: list(raw.jobs, "content.jobs", job) };

  // Ids are global, not per job: activity is keyed by id alone.
  const seen = new Set<string>();

  for (const [jobIndex, entry] of content.jobs.entries()) {
    for (const [productIndex, item] of entry.products.entries()) {
      if (seen.has(item.id)) {
        fail(`content.jobs[${jobIndex}].products[${productIndex}].id`, `"${item.id}" is used twice`);
      }

      seen.add(item.id);
    }
  }

  return content;
}

export function parseCareerActivity(value: unknown): CareerActivity {
  const raw = record(value, "activity", ["generatedAt", "products"]);
  const generatedAt = text(raw.generatedAt, "activity.generatedAt");

  if (Number.isNaN(Date.parse(generatedAt))) {
    fail("activity.generatedAt", `expected an ISO timestamp, got "${generatedAt}"`);
  }

  const productsRaw = record(raw.products, "activity.products", null);
  const products: Record<string, ActivityWeek[]> = {};

  for (const [id, weeksRaw] of Object.entries(productsRaw)) {
    const path = `activity.products.${id}`;

    if (!PRODUCT_ID.test(id)) {
      fail(path, "product ids must be lowercase letters, digits and single dashes");
    }

    const weeks = list(weeksRaw, path, (entry, entryPath) => {
      const week = record(entry, entryPath, ["week", "commits"]);
      const monday = date(week.week, `${entryPath}.week`);

      if (new Date(`${monday}T00:00:00Z`).getUTCDay() !== 1) {
        fail(`${entryPath}.week`, `${monday} is not a Monday`);
      }

      if (!Number.isInteger(week.commits) || (week.commits as number) < 1) {
        fail(`${entryPath}.commits`, "expected a positive whole number");
      }

      return { week: monday, commits: week.commits as number };
    });

    for (let index = 1; index < weeks.length; index += 1) {
      if (weeks[index]!.week <= weeks[index - 1]!.week) {
        fail(`${path}[${index}].week`, "weeks must be in ascending order without repeats");
      }
    }

    products[id] = weeks;
  }

  return { generatedAt: new Date(generatedAt).toISOString(), products };
}
