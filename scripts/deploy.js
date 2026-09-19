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
 *   node scripts/deploy.js --no-tag     deploy without recording a release
 *   node scripts/deploy.js --allow-dirty ship uncommitted work (implies --no-tag)
 *
 * Every full deploy is recorded: an immutable `release-<date>-<n>` tag on the
 * deployed commit, a `release` branch moved to it, and the same identifier
 * compiled into the Lambda (GET /api/health) and written to /release.json.
 * Rolling back is `git checkout <tag>` followed by another deploy.
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
// Deploying uncommitted work makes "which release is live" unanswerable, so it
// is refused by default. The escape hatch exists for emergencies and disables
// tagging, because there is no commit that describes what went out.
const allowDirty = args.has("--allow-dirty");
const skipTag = args.has("--no-tag") || allowDirty;
// Neither flag means both halves; naming one narrows the deploy to it.
const onlyWeb = args.has("--web");
const onlyApi = args.has("--api");
const doWeb = onlyWeb || !onlyApi;
const doApi = onlyApi || !onlyWeb;
// A partial deploy leaves the two halves on different commits, so the release
// it produced is not one state of the repository and is not worth naming.
const doTag = !skipTag && doWeb && doApi;

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

/** git is a real executable everywhere, so no shell and no quoting concerns. */
function git(commandArgs) {
  return execFileSync("git", commandArgs, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  }).trim();
}

/**
 * Dated and sequenced rather than semantic: these mark "what was live on this
 * day", not an API contract, and inventing version numbers for a portfolio is
 * ceremony. The suffix comes from the highest existing number for today, so a
 * deleted tag does not cause a collision.
 */
function nextReleaseTag() {
  const today = new Date().toISOString().slice(0, 10);
  const prefix = `release-${today}-`;

  const highest = git(["tag", "--list", `${prefix}*`])
    .split("\n")
    .filter(Boolean)
    .reduce((max, tag) => Math.max(max, Number.parseInt(tag.slice(prefix.length), 10) || 0), 0);

  return `${prefix}${highest + 1}`;
}

/**
 * Commit the deploy is built from, plus the tag it will be labelled with.
 * Resolved before anything is built so the identifier can be compiled into
 * both artifacts; the tag itself is only created once the deploy succeeds.
 */
function resolveRelease() {
  try {
    git(["rev-parse", "--is-inside-work-tree"]);
  } catch {
    fail("Not a git repository. Deploys are labelled from git history.");
  }

  const dirty = git(["status", "--porcelain"]);

  if (dirty && !allowDirty) {
    fail(
      "Working tree is not clean, so the deployed code would match no commit:\n\n" +
        `${dirty}\n\n` +
        "Commit or stash first. To ship anyway, pass --allow-dirty; that also\n" +
        "skips tagging, because there would be nothing honest to tag.",
    );
  }

  const commit = git(["rev-parse", "HEAD"]);

  return {
    commit,
    shortCommit: commit.slice(0, 7),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: Boolean(dirty),
    tag: doTag ? nextReleaseTag() : null,
  };
}

function preflight(source) {
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
  console.log(`    commit   ${source.shortCommit} on ${source.branch}${source.dirty ? " (DIRTY)" : ""}`);
  console.log(`    release  ${source.tag ?? "untagged"}`);
}

function build(source) {
  if (skipBuild) return;

  if (doWeb) {
    heading("Build client");
    npm(["-w", "client", "run", "build"]);
  }

  if (doApi) {
    heading("Bundle API");
    // Compiled into the bundle by server/scripts/bundle.js, so GET /api/health
    // reports which build is answering instead of leaving it to be inferred.
    process.env.RELEASE = source.tag ?? source.shortCommit;
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

function deployWeb(source) {
  heading("Upload site to S3");

  const dist = resolve(root, "client", "dist");

  if (!existsSync(join(dist, "index.html"))) {
    fail(`No build at ${dist}. Drop --skip-build, or run \`npm run build\` first.`);
  }

  // Served at /release.json so "what is live right now" is answerable without
  // AWS access. Written before the upload so it ships with the build it
  // describes. Not cached: see the index.html pass below.
  writeFileSync(
    join(dist, "release.json"),
    `${JSON.stringify(
      {
        release: source.tag ?? source.shortCommit,
        commit: source.commit,
        branch: source.branch,
        dirty: source.dirty,
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  const target = `s3://${config.bucket}`;
  const files = listFiles(dist);

  // Vite content-hashes everything it emits into assets/ and copies public/
  // through to the root verbatim. Only the first group may be cached forever:
  // a new build of a hashed asset writes a new key, so the old one is never
  // consulted again. Root files keep their names across builds — caching
  // og.png for a year would make the link preview image unchangeable.
  const hashed = files.filter((file) => file.startsWith("assets/"));
  const rootFiles = files.filter((file) => !file.startsWith("assets/"));
  const extensions = new Set(hashed.map((file) => extname(file)));

  // One pass per extension so each group carries a content type the CLI did
  // not have to guess. sync compares size and mtime, so the catch-all pass
  // below will not re-upload — and therefore will not overwrite — these.
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
      `assets/*${extension}`,
      "--content-type",
      contentType,
      "--cache-control",
      IMMUTABLE,
      "--only-show-errors",
    ]);
  }

  // Any hashed asset with an extension this script does not know, plus
  // --prune's deletions.
  aws([
    "s3",
    "sync",
    dist,
    target,
    "--exclude",
    "*",
    "--include",
    "assets/*",
    "--cache-control",
    IMMUTABLE,
    "--only-show-errors",
    // Off by default: the intro lazy-loads its three.js chunk, so deleting the
    // previous build's hashed assets breaks any tab that is open mid-deploy and
    // has not fetched that chunk yet. Stale assets are cheap; broken tabs are not.
    ...(prune ? ["--delete"] : []),
  ]);

  // Root files last, so every hashed asset they reference is already in place.
  // One `cp` each rather than a sync: there are a handful, each needs its own
  // content type, and `no-cache` means revalidate — CloudFront still stores
  // them, it just asks S3 whether its copy is current, which is what makes a
  // replaced og.png visible after the invalidation below.
  for (const file of rootFiles.sort()) {
    aws([
      "s3",
      "cp",
      join(dist, file),
      `${target}/${file}`,
      "--content-type",
      CONTENT_TYPES.get(extname(file)) ?? "application/octet-stream",
      "--cache-control",
      SHELL,
      "--only-show-errors",
    ]);
  }

  console.log(`    ${hashed.length} hashed + ${rootFiles.length} root -> ${target}`);

  // The caller invalidates exactly these: the keys that can change content
  // while keeping their name.
  return rootFiles;
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

function invalidate(rootFiles) {
  heading("Invalidate CloudFront");

  // Exactly the keys whose content can change while the name stays the same:
  // "/" plus everything Vite copied from public/ to the root. Hashed assets
  // never need it — a new build writes new keys nobody has cached. "/*" would
  // also evict the cached project media and bill for the privilege.
  const paths = ["/", ...rootFiles.map((file) => `/${file}`)];

  const result = JSON.parse(
    aws(
      ["cloudfront", "create-invalidation", "--distribution-id", config.distributionId, "--paths", ...paths],
      { capture: true },
    ),
  );

  console.log(`    ${result.Invalidation.Id} (${result.Invalidation.Status})`);
  console.log(`    ${paths.length} paths`);
}

/**
 * Records what just went live: an immutable tag naming this exact commit, and
 * a `release` branch moved to it so `git diff release main` is the list of
 * unreleased work.
 *
 * Runs last on purpose — a tag created before a failed upload would name a
 * release that never existed. Rolling back is then `git checkout <tag>` and
 * deploying again.
 */
function tagRelease(source) {
  heading("Tag release");

  git(["tag", "-a", source.tag, "-m", `Deployed ${source.shortCommit} from ${source.branch}`]);

  // `git branch -f` refuses to move the branch that is currently checked out,
  // and when it is checked out it is already at HEAD anyway.
  if (source.branch !== "release") {
    git(["branch", "-f", "release", source.commit]);
  }

  console.log(`    ${source.tag} -> ${source.shortCommit}`);
  console.log("    release -> same commit");

  const refs = [`refs/tags/${source.tag}`, "release"];

  try {
    git(["push", "origin", ...refs]);
    console.log("    pushed to origin");
  } catch {
    // A rollback deploy moves `release` backwards, which a plain push rejects
    // as non-fast-forward. Retry with a lease so a branch someone else moved
    // still stops us, while our own rewind goes through.
    //
    // Ordered this way because --force-with-lease needs a remote-tracking ref
    // to compare against, and on the very first push of `release` there is
    // none — it would fail with "stale info" before the plain push ever ran.
    try {
      git(["push", "--force-with-lease", "origin", ...refs]);
      console.log("    pushed to origin (rewound release)");
    } catch (error) {
      // The deploy itself succeeded and the site is live; failing to push is a
      // bookkeeping problem, so report it precisely rather than exiting non-zero.
      const detail = error.stderr?.toString().trim() || error.message;
      console.warn(`\n    Could not push to origin — the release is live but unpushed.`);
      console.warn(`    ${detail}`);
      console.warn(`    Retry with: git push origin ${source.tag} release`);
    }
  }
}

const source = resolveRelease();

try {
  preflight(source);
  build(source);
  const rootFiles = doWeb ? deployWeb(source) : [];
  if (doApi) await deployApi();
  if (doWeb) invalidate(rootFiles);
  if (doTag) tagRelease(source);
} catch (error) {
  // execFileSync throws with the whole command line in the message, which
  // buries the one line that matters. Non-captured calls already printed the
  // CLI's own error to stderr; captured ones carry it here.
  const detail = error.stderr?.toString().trim() || error.message;
  fail(`Deploy stopped:\n${detail}`);
}

console.log("\n\x1b[32mDeployed.\x1b[0m\n");
