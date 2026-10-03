import type { Writable } from "node:stream";
import { streamHandle } from "hono/aws-lambda";
import type { LambdaContext, LambdaEvent } from "hono/aws-lambda";
import { app } from "./app.js";
import { keepAlive } from "./contact/index.js";

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

const http = streamHandle(app) as unknown as StreamingHandler;

/** What the EventBridge Scheduler rule in DEPLOY.md sends: its fixed JSON input. */
type KeepAliveEvent = { keepAlive: true };

/**
 * The one function serves two callers: CloudFront, through the Function URL,
 * and a daily schedule that keeps the contact form's free Supabase project from
 * being paused for inactivity. The schedule's event is not an HTTP request, so
 * it is answered here rather than handed to Hono, which would fail to parse it.
 *
 * `streamifyResponse` marks the function it is given and returns that same
 * function, so `http` can be called directly from inside this one.
 */
export const handler: StreamingHandler = awslambda.streamifyResponse(
  async (event: LambdaEvent | KeepAliveEvent, responseStream: Writable, context: LambdaContext) => {
    if ("keepAlive" in event) {
      console.log(`Contact keep-alive: ${await keepAlive()}`);
      responseStream.end();
      return;
    }

    await http(event, responseStream, context);
  },
);

declare global {
  /** Provided by the Lambda Node.js runtime; streamHandle relies on it too. */
  const awslambda: {
    streamifyResponse: <T extends (...args: never[]) => unknown>(handler: T) => StreamingHandler;
  };
}
