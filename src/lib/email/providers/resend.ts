import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";

const DEFAULT_FROM = "Thrive Pilot <dev@heal-3.com>";

type ResendErrorBody = {
  message?: string;
  name?: string;
  type?: string;
};

type ResendSuccessBody = {
  id?: string;
};

function parseNumberHeader(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export const resendProvider: EmailProvider = {
  name: "resend",
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        provider: "resend",
        kind: "permanent",
        detail: "Missing RESEND_API_KEY environment variable",
      };
    }

    const from = input.from ?? process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM;

    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: input.to,
          subject: input.subject,
          html: input.html,
        }),
      });
    } catch (e) {
      return {
        ok: false,
        provider: "resend",
        kind: "temporary",
        detail: e instanceof Error ? e.message : "Network error",
      };
    }

    const dailyQuota = parseNumberHeader(res.headers.get("x-resend-daily-quota"));
    const dailyUsed = parseNumberHeader(res.headers.get("x-resend-daily-quota-used"));
    const monthlyQuota = parseNumberHeader(res.headers.get("x-resend-monthly-quota"));
    const monthlyUsed = parseNumberHeader(res.headers.get("x-resend-monthly-quota-used"));

    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as ResendSuccessBody;
      const id = json?.id ?? "";
      return {
        ok: true,
        provider: "resend",
        messageId: id,
        quota: {
          daily: { used: dailyUsed, limit: dailyQuota },
          monthly: { used: monthlyUsed, limit: monthlyQuota },
        },
      };
    }

    const errJson = (await res.json().catch(() => ({}))) as { error?: ResendErrorBody } & ResendErrorBody;
    const err = errJson?.error ?? errJson;
    const type = (err?.type ?? err?.name ?? "").toString();
    const message = (err?.message ?? "Resend request failed").toString();

    const is429 = res.status === 429;
    const isQuota =
      is429 &&
      /daily_quota_exceeded|monthly_quota_exceeded|reached_daily_quota|reached_monthly_quota/i.test(type + " " + message);

    if (isQuota) {
      return { ok: false, provider: "resend", kind: "quota", detail: message, status: res.status };
    }

    if (is429) {
      return { ok: false, provider: "resend", kind: "rate", detail: message, status: res.status };
    }

    if (res.status >= 500) {
      return { ok: false, provider: "resend", kind: "temporary", detail: message, status: res.status };
    }

    // 4xx validation/auth errors are treated as permanent.
    return { ok: false, provider: "resend", kind: "permanent", detail: message, status: res.status };
  },
};

