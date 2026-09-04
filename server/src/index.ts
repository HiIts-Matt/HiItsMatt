import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { env } from "./env.js";

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}/api`);
  console.log(`GitHub owner: ${env.githubUsername}`);

  if (!env.githubToken) {
    console.warn(
      "GITHUB_TOKEN is not set: requests are limited to 60/hour per IP and /api/github/contributions will return 503.",
    );
  }
});
