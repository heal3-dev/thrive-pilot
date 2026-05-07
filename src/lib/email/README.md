# Email delivery: queue + quota failover

This app uses a **DB-backed email queue** for reliable delivery and provider failover.

## Overview
- Producers (e.g. Twilio inbound webhook) insert rows into `email_jobs`.
- A Vercel Cron route drains the queue and sends:
  - **Primary**: Resend
  - **Failover**: SendPulse (only on explicit Resend quota exhaustion)

## Env vars

### Required
- `CRON_SECRET`: shared secret for Vercel Cron routes (Authorization: `Bearer <secret>`)
- `RESEND_API_KEY`
- `NEXT_PUBLIC_SITE_URL` (used in alert email links)

### Resend
- `RESEND_FROM_EMAIL` (optional; defaults to `Thrive Pilot <dev@heal-3.com>`)

### SendPulse (failover)
SendPulse uses an OAuth token flow.
- `SENDPULSE_CLIENT_ID`
- `SENDPULSE_CLIENT_SECRET`
- `SENDPULSE_FROM_EMAIL` (optional; falls back to `RESEND_FROM_EMAIL`)

### Queue tuning (optional)
- `EMAIL_QUEUE_BATCH_SIZE` (default 10)
- `EMAIL_QUEUE_MAX_LOOPS` (default 10)

### Alert tuning (optional)
- `MENTOR_UNREAD_ALERT_COOLDOWN_MINUTES` (default 30)

## Vercel Cron schedule
Create a Vercel Cron job to call:
- `GET /api/cron/process-email-queue`

Recommended schedule for near-real-time alerts:
- Every 1 minute (`*/1 * * * *`)

