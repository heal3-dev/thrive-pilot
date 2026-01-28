## Thrive Pilot

Next.js app with Supabase + Twilio integration.

## Getting Started

- **Install deps**

```bash
npm install
```

- **Run the dev server**

```bash
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Create a `.env.local` with:

- **Supabase**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_SITE_URL` (used for invite redirect URLs)
- **Twilio**
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_PHONE_NUMBER`

Note: `src/lib/twilio.ts` requires `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` at runtime.

## Email Configuration (SMTP via Resend)

Invite emails are sent through Supabase Auth using a custom SMTP provider. We use **Resend** as the SMTP service.

### Current Settings (configured in Supabase Dashboard → Auth → SMTP Settings)

| Setting | Value |
|---------|-------|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Sender Email | `dev@heal-3.com` |
| Sender Name | `Thrive Pilot` |
| Min Interval | 60 seconds |

### How it works

1. **Supabase Auth** calls `inviteUserByEmail()` which triggers an invite email
2. **Supabase** sends the email through the configured Resend SMTP server
3. **Resend** delivers the email to the participant

### Resend Setup

To configure Resend SMTP in a new environment:

1. Create a Resend account at [resend.com](https://resend.com)
2. Add and verify your sending domain
3. Generate an API key (used as the SMTP password)
4. In Supabase Dashboard → Auth → Email Templates → SMTP Settings:
   - Enable "Custom SMTP"
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: Your Resend API key

## Participant Invite Flow

The invite flow allows admins to invite participants via email. Participants receive a magic link, accept consent terms, and are then ready to receive SMS messages from their mentor.

### Flow Diagram

```
Admin                          Supabase                        Participant
  │                               │                                │
  │ POST /api/admin/participants/invite                            │
  │ ─────────────────────────────>│                                │
  │                               │                                │
  │                               │ Create Auth user               │
  │                               │ Send invite email (via Resend) │
  │                               │ ───────────────────────────────>│
  │                               │                                │
  │ <── 201 Created ──────────────│                                │
  │     (participant record)      │                                │
  │                               │                                │
  │                               │        Clicks magic link       │
  │                               │ <───────────────────────────────│
  │                               │                                │
  │                               │ Redirect to /invite/consent    │
  │                               │ ───────────────────────────────>│
  │                               │                                │
  │                               │    Accepts consent (POST)      │
  │                               │ <───────────────────────────────│
  │                               │                                │
  │                               │ Update participant record      │
  │                               │ (consent_given = true)         │
  │                               │                                │
  │                               │ Redirect to /invite/success    │
  │                               │ ───────────────────────────────>│
```

### API Endpoints

#### `POST /api/admin/participants/invite`

Send an email invitation to a new participant.

- **Auth**: requires admin-level mentor (via Bearer token)
- **Body**:
  - `email` (string, required) - participant's email address
  - `name` (string, optional) - participant's display name
- **Behavior**:
  1. Validates admin permissions
  2. Checks for duplicate email in `participants` table
  3. Calls `supabase.auth.admin.inviteUserByEmail()` to create Auth user and send invite
  4. Creates a `participants` record linked to the Auth user
  5. The invite email contains a magic link to `/invite/consent`

**Response**:

```json
{
  "participant": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "phone_number": ""
  },
  "inviteSent": true,
  "message": "Participant created. Invite email requested."
}
```

**Errors**:
- `400` - Invalid request body
- `401` - Missing or invalid auth token
- `403` - Admin access required
- `409` - Participant with this email already exists
- `500` - Failed to invite or create participant

#### `POST /api/invite/consent`

Called when a participant accepts consent terms after clicking the invite link.

- **Auth**: requires valid session (from magic link)
- **Behavior**:
  1. Validates the user's session
  2. Looks up participant by email
  3. Updates `consent_given = true` and `consent_timestamp`
  4. If participant record doesn't exist, creates one (fallback for edge cases)

### Pages

| Route | Purpose |
|-------|---------|
| `/invite/consent` | Consent form shown after clicking invite link |
| `/invite/success` | Confirmation page after accepting consent |

### Redirect URL Resolution

The invite redirect URL is determined in order of priority:

1. `NEXT_PUBLIC_SITE_URL` environment variable (recommended for production)
2. `Origin` header from the request
3. `X-Forwarded-Host` header (for proxied requests)

Always set `NEXT_PUBLIC_SITE_URL` in production to ensure consistent redirect URLs.

## API

### `POST /api/sms/send`

Send an outbound SMS message to an assigned participant.

- **Auth**: requires `Authorization: Bearer <SUPABASE_ACCESS_TOKEN>`
- **Body**:
  - `participantId` (string, required)
  - `messageBody` (string, required, max 1600 chars)
- **Behavior**:
  - Validates request body
  - Uses Supabase RLS to ensure the mentor can access the participant + insert an outbound message
  - Sends SMS via Twilio
  - Persists record to `sms_messages` with:
    - `participant_id`
    - `mentor_id` (mentor primary key from `mentors.id`)
    - `direction = 'outbound'`
    - `message_body`
    - `twilio_sid`
    - `twilio_status`
    - `message_type = 'mentor_message'`

#### Example `curl`

```bash
curl -X POST "http://localhost:3000/api/sms/send" \
  -H "Authorization: Bearer YOUR_SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "participantId": "YOUR_PARTICIPANT_UUID",
    "messageBody": "Test message"
  }'
```

#### Success Response

```json
{ "messageId": "SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "status": "queued" }
```

#### Error Responses

- **401**: missing/invalid token
- **400**: invalid request body
- **404**: mentor record not found OR participant not found / not accessible (RLS)
- **500**: failed to persist `sms_messages` record
- **502**: Twilio API request failed

## Notes

- **Assignment enforcement**: the route relies on Supabase RLS policies (participants + sms_messages) to ensure mentors can only message assigned participants.

### `POST /api/sms/webhook/incoming`

Twilio webhook to receive inbound SMS and store them in `sms_messages`.

- **Auth**: verified via Twilio request signature (`X-Twilio-Signature`)
- **Body**: `application/x-www-form-urlencoded` (Twilio default)
- **Env**:
  - `SUPABASE_SERVICE_ROLE_KEY` (required to bypass RLS for webhook processing)
  - `TWILIO_INCOMING_WEBHOOK_URL` (optional but recommended; set to the exact public webhook URL configured in Twilio for reliable signature verification)

#### Returns

- **200** on success (Twilio expects 200)
- **403** on invalid signature
- **200** if participant not found (logged; treated as non-transient to avoid retries)
- **500** on DB errors

#### Phone number matching note

The webhook matches `participants.phone_number` against Twilio’s `From`. For best reliability, store phone numbers in **E.164** format (e.g. `+15551234567`). The webhook normalizes the incoming `From` by stripping formatting characters.

#### `message_type` note

Inbound messages are tagged as:
- `user_command` for common keywords (e.g. `STOP`, `HELP`, `START`, `TEST`)
- `user_message` otherwise

#### ⚠️ Twilio compliance keyword quirk (HELP/INFO/STOP/START)

Twilio may treat some inbound keywords as **compliance commands** and handle them before they reach your app (this can vary based on Messaging Service / number settings):

| Type | Keywords | Auto-Reply |
|------|----------|------------|
| Opt-Out | `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`, `OPTOUT`, `REVOKE` | "You have successfully been unsubscribed..." |
| Opt-In | `START`, `YES`, `UNSTOP` | "You have successfully been re-subscribed..." |
| Help | `HELP`, `INFO` | "Reply STOP to unsubscribe..." |

**What this means:**
- The inbound webhook (`/api/sms/webhook/incoming`) may **not receive** the participant command and/or the auto-reply.
- The status webhook (`/api/sms/webhook/status`) may still fire for Twilio’s auto-reply message.
- During local testing, `HELP`/`INFO` can appear to “skip” the inbound webhook even though an auto-reply is sent.

**How we handle it:**
The status webhook (`/api/sms/webhook/status`) detects unknown `MessageSid`s from auto-replies and fetches the message details from Twilio to store them as `system_auto_reply`. This helps preserve conversation history even when the inbound webhook doesn’t receive the auto-reply.

**If you need to capture opt-out keywords:**
You can disable Advanced Opt-Out in Twilio Console → Messaging → Services → your service → Opt-Out Management, then handle keywords manually in your incoming webhook. However, this makes you responsible for TCPA/carrier compliance.

### `POST /api/sms/webhook/status`

Twilio status callback webhook to update delivery state for outbound messages in `sms_messages`.

- **Auth**: verified via Twilio request signature (`X-Twilio-Signature`)
- **Body**: `application/x-www-form-urlencoded`
- **Env**:
  - `SUPABASE_SERVICE_ROLE_KEY` (required)
  - `TWILIO_STATUS_WEBHOOK_URL` (optional but recommended; set to the exact public webhook URL configured in Twilio for reliable signature verification)

#### Updates

- `twilio_status` (always)
- `sent_at` when status becomes `sent`
- `delivered_at` when status becomes `delivered`
- `failed_at` + `failure_reason` when status becomes `failed`/`undelivered`
- `updated_at` (always)

#### Auto-reply storage

If Twilio posts a status callback for a `MessageSid` we don’t already have (e.g. opt-out/help auto replies),
the handler will fetch message details from Twilio and insert an `sms_messages` row tagged as:
- `system_auto_reply` when Twilio reports `direction = outbound-reply`
- otherwise `notification`

