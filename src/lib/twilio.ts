import twilio, { type Twilio } from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
  throw new Error(
    "Missing Twilio credentials. Ensure TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are set."
  );
}

export const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER ?? "";

export const twilioClient: Twilio = twilio(accountSid, authToken);

type WebhookParams = Record<string, string>;

export function verifyTwilioSignature(
  url: string,
  params: WebhookParams,
  signature: string
): boolean {
  if (!authToken) {
    throw new Error(
      "Missing TWILIO_AUTH_TOKEN. Cannot verify Twilio webhook signature."
    );
  }

  return twilio.validateRequest(authToken, signature, url, params);
}
