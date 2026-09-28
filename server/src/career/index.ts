import { cached } from "../cache.js";
import { store } from "../store/index.js";
import {
  CAREER_ACTIVITY_KEY,
  CAREER_CONTENT_KEY,
  careerAssetKey,
  parseCareerActivity,
  parseCareerContent,
  type CareerActivity,
  type CareerAsset,
  type CareerContent,
} from "./schema.js";
import { buildCareer, type Career } from "./timeline.js";

/**
 * Short on purpose: this is the whole delay between `npm run career -- push`
 * and the live page, and each read is one small S3 object.
 */
const CAREER_TTL_MS = 60 * 1000;

export class CareerError extends Error {
  readonly status: 404;

  constructor(message: string, status: 404) {
    super(message);
    this.name = "CareerError";
    this.status = status;
  }
}

function getSource(): Promise<{ content: CareerContent; activity: CareerActivity | null }> {
  return cached("career", CAREER_TTL_MS, async () => {
    const [content, activity] = await Promise.all([
      store.read(CAREER_CONTENT_KEY),
      store.read(CAREER_ACTIVITY_KEY),
    ]);

    if (content === null) {
      throw new CareerError("Career details have not been published yet.", 404);
    }

    // Both were validated by the CLI before upload; a failure here means the
    // object was edited in the bucket by hand, and the page shows its error.
    return {
      content: parseCareerContent(content),
      activity: activity === null ? null : parseCareerActivity(activity),
    };
  });
}

export async function getCareer(): Promise<Career> {
  const { content, activity } = await getSource();

  return buildCareer(content, activity);
}

/**
 * One logo, by the file name the content gives it. Only names the published
 * content actually uses are served — the membership test, not the name's
 * shape, is what keeps this route from reading anything else in the store.
 */
export async function getCareerAsset(name: string): Promise<{ contentType: string; bytes: Uint8Array }> {
  const { content } = await getSource();
  const named = content.jobs.some((job) => job.products.some((product) => product.logo === name));

  if (!named) {
    throw new CareerError(`"${name}" is not a published career asset.`, 404);
  }

  const asset = await cached(`career-asset:${name}`, CAREER_TTL_MS, async () => {
    const stored = (await store.read(careerAssetKey(name))) as CareerAsset | null;

    if (!stored) {
      throw new CareerError(`"${name}" is named in the content but was never uploaded.`, 404);
    }

    return { contentType: stored.contentType, bytes: Buffer.from(stored.data, "base64") };
  });

  return asset;
}
