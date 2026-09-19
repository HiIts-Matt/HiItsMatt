/**
 * Bundles the Lambda handler to a single ESM file.
 *
 * Uses esbuild's JS API rather than its CLI so the release identifier can be
 * injected without shell-specific quoting — `--define:__RELEASE__=\"$RELEASE\"`
 * is three different expressions in bash, cmd and PowerShell.
 *
 * RELEASE is set by scripts/deploy.js. Bundling by hand without it produces a
 * build that reports itself as "dev", which is the honest answer.
 */

import { build } from "esbuild";

const release = process.env.RELEASE?.trim() || "dev";

await build({
  entryPoints: ["src/lambda.ts"],
  outfile: "dist-lambda/index.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // Textual substitution of the identifier declared in src/release.ts.
  define: { __RELEASE__: JSON.stringify(release) },
  logLevel: "info",
});

console.log(`release: ${release}`);
