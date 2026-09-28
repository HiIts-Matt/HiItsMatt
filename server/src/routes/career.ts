import { Hono } from "hono";
import { getCareer, getCareerAsset } from "../career/index.js";

export const careerRoutes = new Hono()
  .get("/", async (c) => c.json(await getCareer()))
  // Logos live in the data store with the rest of the career data, so a new
  // employer's arrive with a push rather than a deploy.
  .get("/assets/:name", async (c) => {
    const asset = await getCareerAsset(c.req.param("name"));

    return new Response(asset.bytes, {
      headers: {
        "Content-Type": asset.contentType,
        // Short: replacing a logo under the same name should show within minutes.
        "Cache-Control": "public, max-age=300",
        // Store-supplied bytes: pin the type, and an SVG opened directly can
        // still not run anything.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  });
