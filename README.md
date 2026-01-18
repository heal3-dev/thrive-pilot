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
- **Twilio**
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_PHONE_NUMBER`

Note: `src/lib/twilio.ts` requires `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` at runtime.

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

The webhook matches `participants.phone_number` against Twilio’s `From`. For best reliability, store phone numbers in **E.164** format (e.g. `+16045551234`). The webhook normalizes the incoming `From` by stripping formatting characters.

#### `message_type` note

Inbound messages are tagged as:
- `user_command` for common keywords (e.g. `STOP`, `HELP`, `START`, `TEST`)
- `user_message` otherwise

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

