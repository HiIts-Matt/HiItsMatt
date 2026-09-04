import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./env.js";
import { GitHubError } from "./github/rest.js";
import { githubRoutes } from "./routes/github.js";

const app = new Hono().basePath("/api");

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: env.corsOrigins,
    allowMethods: ["GET", "OPTIONS"],
  }),
);

app.onError((error, c) => {
  if (error instanceof GitHubError) {
    // GitHubError statuses are chosen upstream: 429 rate limit, 503 missing
    // capability, 404 unknown repo, 502 anything else GitHub did.
    return c.json({ error: error.message }, error.status);
  }

  console.error("Unhandled request error:", error);

  return c.json({ error: "Internal server error." }, 500);
});

// One chained expression so AppType carries every route; splitting these into
// separate statements would erase the RPC types the client imports.
const routes = app
  .get("/health", (c) => c.json({ ok: true as const, uptimeSeconds: Math.round(process.uptime()) }))
  .route("/github", githubRoutes);

export { app };
export type AppType = typeof routes;

// The client imports these alongside AppType to type its own props; keeping the
// re-export here means `server` is the single entry point for both.
export type {
  ContributionDay,
  ContributionWeek,
  LanguageStat,
  Profile,
  Repo,
} from "./github/types.js";
