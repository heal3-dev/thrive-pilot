import twilio, { type Twilio } from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

export const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER ?? "";

let _twilioClient: Twilio | null = null;
function getTwilioClient(): Twilio {
  if (_twilioClient) return _twilioClient;
  if (!accountSid || !authToken) {
    throw new Error(
      "Missing Twilio credentials. Ensure TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are set."
    );
  }
  _twilioClient = twilio(accountSid, authToken);
  return _twilioClient;
}

// Lazy proxy avoids throwing during Next.js build module evaluation.
export const twilioClient: Twilio = new Proxy({} as Twilio, {
  get(_target, prop) {
    const client = getTwilioClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = (client as any)[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

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
