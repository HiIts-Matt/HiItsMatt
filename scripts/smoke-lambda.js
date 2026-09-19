/**
 * Loads the bundled Lambda handler in this process and invokes it with a
 * synthetic Function URL request, so a bundle that cannot even start is caught
 * here instead of by the first visitor.
 *
 * It catches the failures that only appear after bundling: a dependency esbuild
 * could not resolve, a missing GITHUB_USERNAME (env.ts throws at import, which
 * on Lambda surfaces as an opaque init error), and a broken streaming ABI.
 *
 *   node scripts/smoke-lambda.js
 */

import { Writable } from "node:stream";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Minimal API Gateway v2 payload — the shape a Function URL delivers. */
function requestEvent(path) {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: { host: "smoke.invalid", "user-agent": "deploy-smoke" },
    requestContext: {
      accountId: "anonymous",
      apiId: "smoke",
      domainName: "smoke.invalid",
      domainPrefix: "smoke",
      http: {
        method: "GET",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "deploy-smoke",
      },
      requestId: "smoke",
      routeKey: "$default",
      stage: "$default",
      time: "01/Jan/1980:00:00:00 +0000",
      timeEpoch: 315532800000,
    },
    isBase64Encoded: false,
  };
}

/**
 * @param {string} bundlePath Path to the esbuild output.
 * @returns {Promise<{ status: number, body: string }>}
 * @throws If the bundle fails to load or /api/health does not answer 200.
 */
export async function smokeBundle(bundlePath) {
  let metadata = null;

  // The Lambda runtime provides these; streamHandle calls streamifyResponse at
  // module scope, so they must exist before the import below.
  globalThis.awslambda = {
    streamifyResponse: (fn) => fn,
    HttpResponseStream: {
      from(stream, httpResponseMetadata) {
        metadata = httpResponseMetadata;
        return stream;
      },
    },
  };

  const { handler } = await import(pathToFileURL(bundlePath).href);

  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });

  await handler(requestEvent("/api/health"), stream, { awsRequestId: "smoke" });

  const body = Buffer.concat(chunks).toString("utf8");

  if (metadata?.statusCode !== 200) {
    throw new Error(`/api/health answered ${metadata?.statusCode ?? "nothing"}: ${body}`);
  }

  return { status: metadata.statusCode, body };
}

// Direct invocation: `node scripts/smoke-lambda.js`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bundlePath = resolve(import.meta.dirname, "..", "server", "dist-lambda", "index.mjs");
  const result = await smokeBundle(bundlePath);
  console.log(`${result.status} ${result.body}`);
}
