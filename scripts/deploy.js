/**
 * Deploys the site to the AWS resources described in DEPLOY.md.
 *
 * Two artifacts, two destinations:
 *   client/dist            -> S3, served by CloudFront's default behaviour
 *   server/src/lambda.ts   -> one bundled .mjs in a Lambda behind /api/*
 *
 * Infrastructure is created once by hand (see DEPLOY.md); this script only
 * pushes code, so it needs nothing beyond the AWS CLI and four ids.
 *
 * Usage:
 *   node scripts/deploy.js              build and push both halves
 *   node scripts/deploy.js --web        static site only
 *   node scripts/deploy.js --api        lambda only
 *   node scripts/deploy.js --skip-build reuse the existing build output
 *   node scripts/deploy.js --prune      also delete bucket objects that the
 *                                       current build no longer produces
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { smokeBundle } from "./smoke-lambda.js";
import { zip } from "./zip.js";

const root = resolve(import.meta.dirname, "..");
const configPath = resolve(root, ".env.deploy");

if (existsSync(configPath)) {
  process.loadEnvFile(configPath);
}

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const prune = args.has("--prune");
// Neither flag means both halves; naming one narrows the deploy to it.
const onlyWeb = args.has("--web");
const onlyApi = args.has("--api");
const doWeb = onlyWeb || !onlyApi;
const doApi = onlyApi || !onlyWeb;

const config = {
  region: process.env.AWS_REGION,
  bucket: process.env.SITE_BUCKET,
  functionName: process.env.LAMBDA_FUNCTION_NAME,
  distributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
};

/**
 * Content types are set explicitly rather than left to the CLI, which derives
 * them from Python's mimetypes — and on Windows that reads HKEY_CLASSES_ROOT,
 * where a stray registry entry can serve every .js file as text/plain and the
 * browser then refuses to execute the bundle.
 */
const CONTENT_TYPES = new Map([
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".ttf", "font/ttf"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
]);

/** Vite fingerprints everything under assets/; only the shell is mutable. */
const IMMUTABLE = "public, max-age=31536000, immutable";
const SHELL = "no-cache";

let step = 0;

function heading(text) {
  step += 1;
  console.log(`\n\x1b[1m[${step}] ${text}\x1b[0m`);
}

function fail(message) {
  console.error(`\n\x1b[31m${message}\x1b[0m\n`);
  process.exit(1);
}

/**
 * npm is a .cmd shim on Windows, which execFile refuses to start directly, so
 * these calls go through a shell. Every argument here is a literal — nothing
 * from configuration or the filesystem reaches this, which matters because
 * `shell: true` does no quoting of its own.
 */
function npm(commandArgs) {
  return execFileSync("npm", commandArgs, {
    cwd: root,
    stdio: "inherit",
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

/**
 * The AWS CLI is a real executable on every platform (aws.exe from the v2
 * installer on Windows), so it runs without a shell — which is what lets
 * arguments containing spaces, such as the Cache-Control values, be passed
 * through verbatim instead of needing per-platform quoting.
 */
function aws(commandArgs, options = {}) {
  return execFileSync("aws", [...commandArgs, "--region", config.region, "--output", "json"], {
    cwd: root,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
}

function preflight() {
  heading("Preflight");

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    fail(
      `Missing configuration: ${missing.join(", ")}.\n` +
        "Copy .env.deploy.example to .env.deploy and fill in the ids that\n" +
        "DEPLOY.md tells you to write down as you create each resource.",
    );
  }

  try {
    execFileSync("aws", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    fail("The AWS CLI is not on PATH. Install it: https://aws.amazon.com/cli/");
  }

  let identity;
  try {
    identity = JSON.parse(aws(["sts", "get-caller-identity"], { capture: true }));
  } catch {
    fail("AWS credentials are not usable. Run `aws configure` (or set AWS_PROFILE).");
  }

  console.log(`    account  ${identity.Account}`);
  console.log(`    identity ${identity.Arn}`);
  console.log(`    region   ${config.region}`);
}

function build() {
  if (skipBuild) return;

  if (doWeb) {
    heading("Build client");
    npm(["-w", "client", "run", "build"]);
  }

  if (doApi) {
    heading("Bundle API");
    npm(["-w", "server", "run", "bundle"]);
  }
}

/** Every file under `dir`, as paths relative to it with forward slashes. */
function listFiles(dir, prefix = "") {
  const files = [];

  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(dir, relative));
    else files.push(relative);
  }

  return files;
}

function deployWeb() {
  heading("Upload site to S3");

  const dist = resolve(root, "client", "dist");

  if (!existsSync(join(dist, "index.html"))) {
    fail(`No build at ${dist}. Drop --skip-build, or run \`npm run build\` first.`);
  }

  const target = `s3://${config.bucket}`;
  const files = listFiles(dist);
  const extensions = new Set(files.filter((f) => f !== "index.html").map((f) => extname(f)));

  // One pass per extension so each group carries a content type the CLI did not
  // have to guess. sync compares size and mtime, so the catch-all pass below
  // will not re-upload — and therefore will not overwrite — what these set.
  for (const extension of [...extensions].sort()) {
    const contentType = CONTENT_TYPES.get(extension);
    if (!contentType) continue;

    aws([
      "s3",
      "sync",
      dist,
      target,
      "--exclude",
      "*",
      "--include",
      `*${extension}`,
      "--exclude",
      "index.html",
      "--content-type",
      contentType,
      "--cache-control",
      IMMUTABLE,
      "--only-show-errors",
    ]);
  }

  // Anything with an extension this script does not know, plus --prune's
  // deletions. index.html is excluded from both: it is uploaded last, after the
  // assets it references are all in place.
  aws([
    "s3",
    "sync",
    dist,
    target,
    "--exclude",
    "index.html",
    "--cache-control",
    IMMUTABLE,
    "--only-show-errors",
    // Off by default: the intro lazy-loads its three.js chunk, so deleting the
    // previous build's hashed assets breaks any tab that is open mid-deploy and
    // has not fetched that chunk yet. Stale assets are cheap; broken tabs are not.
    ...(prune ? ["--delete"] : []),
  ]);

  aws([
    "s3",
    "cp",
    join(dist, "index.html"),
    `${target}/index.html`,
    "--content-type",
    "text/html; charset=utf-8",
    "--cache-control",
    SHELL,
    "--only-show-errors",
  ]);

  console.log(`    ${files.length} files -> ${target}`);
}

async function deployApi() {
  heading("Publish Lambda");

  const bundlePath = resolve(root, "server", "dist-lambda", "index.mjs");

  if (!existsSync(bundlePath)) {
    fail(`No bundle at ${bundlePath}. Drop --skip-build, or run \`npm -w server run bundle\`.`);
  }

  // Load and invoke the real artifact before it reaches production: a bundle
  // that throws at import becomes a Lambda init error with no useful message.
  try {
    await smokeBundle(bundlePath);
  } catch (error) {
    fail(`The bundle failed its local smoke test, so it was not published.\n${error.message}`);
  }

  // Flat: the handler is configured as "index.handler", which Lambda resolves
  // against the root of the archive.
  const archive = zip([{ name: "index.mjs", data: readFileSync(bundlePath) }]);
  const archivePath = resolve(root, "server", "dist-lambda", "function.zip");
  writeFileSync(archivePath, archive);

  const updated = JSON.parse(
    aws(
      [
        "lambda",
        "update-function-code",
        "--function-name",
        config.functionName,
        "--zip-file",
        `fileb://${archivePath}`,
      ],
      { capture: true },
    ),
  );

  // The function is briefly in Pending while the new code is installed; a
  // request that lands in that window is served by the old version, so wait.
  aws(["lambda", "wait", "function-updated-v2", "--function-name", config.functionName]);

  console.log(`    ${(archive.length / 1024).toFixed(1)} KB -> ${updated.FunctionName}`);
  console.log(`    sha256 ${updated.CodeSha256}`);
}

function invalidate() {
  heading("Invalidate CloudFront");

  // Only the shell: every other object is content-hashed, so a new build writes
  // new keys that were never cached under the old ones. Invalidating /* instead
  // would evict the media cache too and bill for it.
  const result = JSON.parse(
    aws(
      [
        "cloudfront",
        "create-invalidation",
        "--distribution-id",
        config.distributionId,
        "--paths",
        "/",
        "/index.html",
      ],
      { capture: true },
    ),
  );

  console.log(`    ${result.Invalidation.Id} (${result.Invalidation.Status})`);
}

try {
  preflight();
  build();
  if (doWeb) deployWeb();
  if (doApi) await deployApi();
  if (doWeb) invalidate();
} catch (error) {
  // execFileSync throws with the whole command line in the message, which
  // buries the one line that matters. Non-captured calls already printed the
  // CLI's own error to stderr; captured ones carry it here.
  const detail = error.stderr?.toString().trim() || error.message;
  fail(`Deploy stopped:\n${detail}`);
}

console.log("\n\x1b[32mDeployed.\x1b[0m\n");
