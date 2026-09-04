import { Hono } from "hono";
import {
  getContributions,
  getLanguages,
  getProfile,
  getReadmeHtml,
  getRepos,
} from "../github/catalog.js";

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
  );
