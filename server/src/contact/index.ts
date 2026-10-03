import { env } from "../env.js";
import { type ContactMessage, sendEmail, sendText } from "./notify.js";

/*
 * The contact form: a message is stored in Supabase first, by a database
 * function that also enforces the rate limit (supabase/migrations), and only
 * then announced by email and text. Once it is stored it is safe, so a failed
 * notification is recorded on its row rather than reported to the sender.
 */

/**
 * Every refusal the form can meet, raised rather than returned so the route's
 * RPC type is only its success and app.ts's onError answers all of them alike.
 */
export class ContactError extends Error {
  readonly status: 400 | 413 | 429 | 503;

  constructor(message: string, status: 400 | 413 | 429 | 503) {
    super(message);
    this.name = "ContactError";
    this.status = status;
  }
}

export type ContactInput = { name: string; email: string; message: string };

export const UNAVAILABLE = "The contact form can't take messages right now. Please email me instead.";

function contactConfig() {
  if (!env.contact) throw new ContactError(UNAVAILABLE, 503);
  return env.contact;
}

/** One call to the project's REST API, with the secret key: RLS lets nothing else in. */
async function supabase(path: string, init: { method: string; body?: unknown; prefer?: string }) {
  const { supabaseUrl, supabaseSecretKey } = contactConfig();
  // Secret keys are not JWTs: they go on `apikey`, never as a Bearer token.
  const headers: Record<string, string> = { apikey: supabaseSecretKey, "Content-Type": "application/json" };
  if (init.prefer) headers.Prefer = init.prefer;

  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000),
  });
}

/** Stores the message, or refuses it when its sender, or everyone, is over the limit. */
async function store(input: ContactInput, ip: string): Promise<number> {
  let response: Response;
  try {
    response = await supabase("rpc/submit_contact", {
      method: "POST",
      body: { p_name: input.name, p_email: input.email, p_message: input.message, p_ip: ip },
    });
  } catch (error) {
    // Unreachable or timed out; a paused free project looks like this too.
    console.error("Contact: Supabase is unreachable:", error);
    throw new ContactError(UNAVAILABLE, 503);
  }

  if (!response.ok) {
    console.error(`Contact: Supabase answered ${response.status}:`, await response.text());
    throw new ContactError(UNAVAILABLE, 503);
  }

  const id: unknown = await response.json();
  if (id === null) {
    throw new ContactError("Too many messages just now. Please try again later, or email me instead.", 429);
  }
  if (typeof id !== "number") {
    console.error("Contact: submit_contact returned", id);
    throw new ContactError(UNAVAILABLE, 503);
  }

  return id;
}

/**
 * Email, then text; neither depends on the other, and each outcome lands on
 * the row. Awaited before the response goes out, because Lambda freezes the
 * moment it does and anything still running would be lost.
 */
async function announce(contact: ContactMessage): Promise<void> {
  const { to, from, smsTo } = contactConfig();
  const outcome: { emailed_at?: string; texted_at?: string; notify_error?: string } = {};
  const errors: string[] = [];

  try {
    await sendEmail(to, from, contact);
    outcome.emailed_at = new Date().toISOString();
  } catch (error) {
    console.error(`Contact: email for #${contact.id} failed:`, error);
    errors.push(`email: ${String(error)}`);
  }

  if (smsTo) {
    try {
      await sendText(smsTo, contact);
      outcome.texted_at = new Date().toISOString();
    } catch (error) {
      console.error(`Contact: text for #${contact.id} failed:`, error);
      errors.push(`text: ${String(error)}`);
    }
  }

  if (errors.length > 0) outcome.notify_error = errors.join("\n");

  try {
    const response = await supabase(`contact_messages?id=eq.${contact.id}`, {
      method: "PATCH",
      body: outcome,
      prefer: "return=minimal",
    });
    if (!response.ok) console.error(`Contact: recording #${contact.id}'s notifications got ${response.status}`);
  } catch (error) {
    console.error(`Contact: recording #${contact.id}'s notifications failed:`, error);
  }
}

export async function submitContact(input: ContactInput, ip: string): Promise<void> {
  const id = await store(input, ip);
  await announce({ id, ...input });
}

/**
 * A query a day keeps a free Supabase project from being paused for
 * inactivity; run by the scheduled event in lambda.ts. Does nothing when the
 * form is not set up.
 */
export async function keepAlive(): Promise<"ok" | "off"> {
  if (!env.contact) return "off";

  const response = await supabase("contact_messages?select=id&limit=1", { method: "GET" });
  if (!response.ok) throw new Error(`Supabase answered ${response.status}: ${await response.text()}`);

  return "ok";
}
