import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";

const DEFAULT_FROM = "Thrive Pilot <dev@heal-3.com>";

type SendPulseTokenBody = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

type SendPulseSendOk = {
  id?: string | number;
  result?: boolean;
};

let cachedToken: { token: string; expiresAt: number } | null = null;

function parseFrom(from: string): { name: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || "Thrive Pilot", email: m[2] };
  return { name: "Thrive Pilot", email: from };
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.SENDPULSE_CLIENT_ID;
  const clientSecret = process.env.SENDPULSE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing SENDPULSE_CLIENT_ID or SENDPULSE_CLIENT_SECRET environment variable");
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.token;
  }

  const res = await fetch("https://api.sendpulse.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SendPulse token request failed (${res.status}): ${text || "unknown error"}`);
  }

  const json = (await res.json().catch(() => ({}))) as SendPulseTokenBody;
  const token = json.access_token;
  const expiresIn = Number(json.expires_in ?? 3600);
  if (!token) throw new Error("SendPulse token response missing access_token");

  cachedToken = { token, expiresAt: now + Math.max(60, expiresIn) * 1000 };
  return token;
}

export const sendPulseProvider: EmailProvider = {
  name: "sendpulse",
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    let token: string;
    try {
      token = await getAccessToken();
    } catch (e) {
      return {
        ok: false,
        provider: "sendpulse",
        kind: "permanent",
        detail: e instanceof Error ? e.message : "Failed to authenticate with SendPulse",
      };
    }

    const from = input.from ?? process.env.SENDPULSE_FROM_EMAIL ?? process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM;
    const parsedFrom = parseFrom(from);

    let res: Response;
    try {
      res = await fetch("https://api.sendpulse.com/smtp/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: {
            html: input.html,
            subject: input.subject,
            from: parsedFrom,
            to: [{ email: input.to }],
          },
        }),
      });
    } catch (e) {
      return {
        ok: false,
        provider: "sendpulse",
        kind: "temporary",
        detail: e instanceof Error ? e.message : "Network error",
      };
    }

    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as SendPulseSendOk;
      const id = (json?.id ?? "").toString();
      return { ok: true, provider: "sendpulse", messageId: id };
    }

    const text = await res.text().catch(() => "");
    const detail = `SendPulse request failed (${res.status}): ${text || "unknown error"}`;

    if (res.status === 429) {
      return { ok: false, provider: "sendpulse", kind: "rate", detail, status: res.status };
    }
    if (res.status >= 500) {
      return { ok: false, provider: "sendpulse", kind: "temporary", detail, status: res.status };
    }
    return { ok: false, provider: "sendpulse", kind: "permanent", detail, status: res.status };
  },
};

