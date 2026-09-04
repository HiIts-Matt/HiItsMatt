import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Resolved relative to this module so it works from both `src` (tsx) and `dist`
// (compiled) — both live exactly one level below the package root.
const envFile = fileURLToPath(new URL("../.env", import.meta.url));

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const githubUsername = process.env.GITHUB_USERNAME?.trim();

if (!githubUsername) {
  throw new Error(
    "GITHUB_USERNAME is required: set it in server/.env (see server/.env.example) or in the environment.",
  );
}

const githubToken = process.env.GITHUB_TOKEN?.trim();

const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

export const env = Object.freeze({
  githubUsername,
  // Optional on purpose: the server boots without it and only the contribution
  // graph is unavailable (GraphQL requires auth), everything else degrades to
  // GitHub's 60 req/hour unauthenticated limit.
  githubToken: githubToken || undefined,
  corsOrigins,
  port: Number(process.env.PORT ?? 3000),
});
