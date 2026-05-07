export type EmailProviderName = "resend" | "sendpulse";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  from?: string; // e.g. "Thrive Pilot <dev@heal-3.com>"
};

export type SendEmailOk = {
  ok: true;
  provider: EmailProviderName;
  messageId: string;
  // Optional quota info; only some providers expose it.
  quota?: {
    daily?: { used?: number; limit?: number };
    monthly?: { used?: number; limit?: number };
  };
};

export type SendEmailErr = {
  ok: false;
  provider: EmailProviderName;
  kind: "quota" | "rate" | "temporary" | "permanent";
  detail: string;
  status?: number;
};

export type SendEmailResult = SendEmailOk | SendEmailErr;

export interface EmailProvider {
  name: EmailProviderName;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

