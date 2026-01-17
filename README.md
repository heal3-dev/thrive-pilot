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

