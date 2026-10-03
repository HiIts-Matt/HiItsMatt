import type * as SesSdk from "@aws-sdk/client-sesv2";
import type * as SnsSdk from "@aws-sdk/client-sns";
import { env } from "../env.js";

/*
 * Loaded on the first message, not at boot: every API request shares this
 * Lambda's cold start, and almost none of them are someone getting in touch.
 * Credentials come from the default chain: the execution role on Lambda,
 * AWS_PROFILE or `aws configure` everywhere else.
 */
const clientConfig = env.awsRegion ? { region: env.awsRegion } : {};
let ses: Promise<{ client: SesSdk.SESv2Client; sdk: typeof SesSdk }> | undefined;
let sns: Promise<{ client: SnsSdk.SNSClient; sdk: typeof SnsSdk }> | undefined;

export type ContactMessage = { id: number; name: string; email: string; message: string };

/**
 * The message itself, to me. It only ever goes to the one verified address,
 * never to the sender — a form that mails whoever it is told to is a spam
 * relay — so replying is what Reply-To is for.
 */
export async function sendEmail(to: string, from: string, contact: ContactMessage): Promise<void> {
  ses ??= import("@aws-sdk/client-sesv2").then((sdk) => ({ client: new sdk.SESv2Client(clientConfig), sdk }));
  const { client, sdk } = await ses;

  await client.send(
    new sdk.SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      ReplyToAddresses: [contact.email],
      Content: {
        Simple: {
          Subject: { Data: `hiitsmatt.dev: message from ${contact.name}`, Charset: "UTF-8" },
          Body: {
            Text: {
              Data: `${contact.message}\n\n— ${contact.name} <${contact.email}>\nMessage #${contact.id}`,
              Charset: "UTF-8",
            },
          },
        },
      },
    }),
  );
}

/**
 * Who wrote, then what they wrote. A long message is cut short: every 153
 * characters is another billed segment (67 when it holds an emoji or other
 * non-GSM character), SNS refuses a text past 1,600 bytes, and the email
 * carries the whole thing anyway.
 */
export async function sendText(to: string, contact: ContactMessage): Promise<void> {
  sns ??= import("@aws-sdk/client-sns").then((sdk) => ({ client: new sdk.SNSClient(clientConfig), sdk }));
  const { client, sdk } = await sns;

  const body = contact.message.length > 300 ? `${contact.message.slice(0, 299)}…` : contact.message;

  await client.send(
    new sdk.PublishCommand({
      PhoneNumber: to,
      Message: `${contact.name}, ${contact.email}:\n${body}`,
      MessageAttributes: {
        "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
      },
    }),
  );
}
