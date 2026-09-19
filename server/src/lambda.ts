import type { Writable } from "node:stream";
import { streamHandle } from "hono/aws-lambda";
import type { LambdaContext, LambdaEvent } from "hono/aws-lambda";
import { app } from "./app.js";

/**
 * Entry point for AWS Lambda, used instead of `index.ts` (which owns the local
 * Node server). The same Hono app backs both.
 *
 * `streamHandle`, not `handle`: the media route pipes upstream bodies straight
 * through, and a buffered Lambda response is capped at 6 MB after base64
 * inflation. Streaming also preserves status and headers verbatim, so the 206 +
 * `Content-Range` produced by a browser's Range request survives the trip.
 *
 * This requires a Function URL with `InvokeMode: RESPONSE_STREAM` — the
 * `awslambda` global that `streamHandle` calls exists only there. API Gateway
 * cannot stream at all, which is why the distribution points at a Function URL.
 */

/**
 * The real ABI of a streaming handler: Lambda passes the response stream as the
 * *second* argument, not the context. Hono types `streamHandle`'s result as its
 * generic `Handler` (event, context, callback), which describes the buffered
 * ABI instead, so the cast below is a correction rather than a silencer.
 */
export type StreamingHandler = (
  event: LambdaEvent,
  responseStream: Writable,
  context: LambdaContext,
) => Promise<void>;

export const handler = streamHandle(app) as unknown as StreamingHandler;
