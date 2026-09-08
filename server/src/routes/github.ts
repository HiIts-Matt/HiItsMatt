import { Hono } from "hono";
import {
  getContributions,
  getLanguages,
  getProfile,
  getReadmeHtml,
  getRepos,
} from "../github/catalog.js";
import { getProjectEntries, openProjectMedia } from "../github/projects.js";

// Chained into a single expression: separate `githubRoutes.get(...)` statements
// would drop the accumulated types that the client's RPC client reads through
// AppType.
export const githubRoutes = new Hono()
  .get("/profile", async (c) => c.json(await getProfile()))
  .get("/languages", async (c) => c.json(await getLanguages()))
  .get("/contributions", async (c) => c.json(await getContributions()))
  .get("/repos", async (c) => c.json({ repos: await getRepos() }))
  .get("/repos/:repo/readme", async (c) =>
    // null means the repo exists but has no README; an unknown repo throws a
    // 404 from the catalog instead.
    c.json({ html: await getReadmeHtml(c.req.param("repo")) }),
  )
  .get("/projects", async (c) => c.json({ entries: await getProjectEntries() }))
  // Assets live behind this server rather than on raw.githubusercontent.com so
  // that private project repositories work without handing a token to the
  // browser. The wildcard is the asset's path inside `.portfolio/`.
  .get("/projects/:slug/media/:path{.+}", async (c) => {
    const media = await openProjectMedia(
      c.req.param("slug"),
      c.req.param("path"),
      c.req.header("range"),
    );

    // A plain Response, not c.body(): the upstream body is piped through
    // untouched, including a 206 when GitHub honours the browser's Range.
    return new Response(media.body, { status: media.status, headers: media.headers });
  });
