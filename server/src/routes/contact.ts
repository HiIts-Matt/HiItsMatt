import type { IncomingMessage } from "node:http";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { validator } from "hono/validator";
import { ContactError, submitContact, UNAVAILABLE } from "../contact/index.js";

/** Enough to reject what is plainly not an address; SES and a reply settle the rest. */
const EMAIL = /^[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[^\s@<>()[\]",;:]+$/;
/** Line breaks and other control characters, which belong in neither a name nor an email header. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * What the form sends. Hono types the RPC client's input from what the
 * validator returns, so it returns exactly these fields; the checks themselves
 * trust none of them.
 */
type ContactBody = { name: string; email: string; message: string; website: string };

function field(raw: unknown, label: string, max: number, singleLine: boolean): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) throw new ContactError(`Please add your ${label}.`, 400);
  if (value.length > max) throw new ContactError(`Your ${label} is too long (${max} characters at most).`, 400);
  if (singleLine && CONTROL.test(value)) throw new ContactError(`Your ${label} has to be on one line.`, 400);
  return value;
}

export const contactRoutes = new Hono().post(
  "/",
  bodyLimit({
    maxSize: 16 * 1024,
    onError: () => {
      throw new ContactError("That message is too long.", 413);
    },
  }),
  validator("json", (body: unknown): ContactBody => {
    const input: Partial<Record<keyof ContactBody, unknown>> = typeof body === "object" && body !== null ? body : {};
    const name = field(input.name, "name", 100, true);
    const email = field(input.email, "email", 254, true);
    if (!EMAIL.test(email)) throw new ContactError("That email address doesn't look right.", 400);
    const message = field(input.message, "message", 5000, false);
    // The honeypot: hidden from people, so only a bot fills it in.
    const website = typeof input.website === "string" ? input.website : "";

    return { name, email, message, website };
  }),
  async (c) => {
    const { website, ...contact } = c.req.valid("json");

    // A bot is told it worked, so it learns nothing worth retrying.
    if (website) return c.json({ ok: true as const }, 200);

    /*
     * The sender's address, for the rate limit. In production CloudFront sets
     * this header itself (`ip:port`, IPv6 unbracketed, so the port is after the
     * last colon); the function URL is reachable only through CloudFront, so a
     * visitor cannot supply their own. Locally it is the Node server's socket.
     */
    const viewer = c.req.header("cloudfront-viewer-address");
    const ip = viewer
      ? viewer.slice(0, viewer.lastIndexOf(":"))
      : (c.env as { incoming?: IncomingMessage } | undefined)?.incoming?.socket.remoteAddress;

    if (!ip) {
      console.error("Contact: no CloudFront-Viewer-Address header; check the /api/contact origin request policy.");
      throw new ContactError(UNAVAILABLE, 503);
    }

    await submitContact(contact, ip);
    return c.json({ ok: true as const }, 200);
  },
);
