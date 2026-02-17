/**
 * POST /api/garmin/fix-user-id
 *
 * Admin-only one-time fix endpoint: fetches the Garmin API User ID for a
 * connected participant and stores it in participants.garmin_user_id.
 *
 * This is needed for participants who connected before the callback was
 * updated to save the user ID automatically.
 *
 * Body (JSON):
 *   - participant_id (string, UUID) — required
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_utils';
import { getValidToken } from '@/lib/garmin/token-manager';
import { fetchGarminUserId } from '@/lib/garmin/oauth-client';

export async function POST(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const participantId = body.participant_id as string | undefined;
  if (!participantId) {
    return NextResponse.json({ error: 'participant_id is required' }, { status: 400 });
  }

  // Get a valid access token for this participant
  const token = await getValidToken(participantId);
  if (!token) {
    return NextResponse.json(
      { error: 'No valid Garmin token found for this participant' },
      { status: 404 },
    );
  }

  // Fetch the Garmin user ID
  let garminUserId: string;
  try {
    garminUserId = await fetchGarminUserId(token.accessToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Save it to the participants table
  const supabase = guard.admin;
  const { error: updateError } = await supabase
    .from('participants')
    .update({ garmin_user_id: garminUserId })
    .eq('id', participantId);

  if (updateError) {
    return NextResponse.json(
      { error: `Failed to update participant: ${updateError.message}` },
      { status: 500 },
    );
  }

  console.log('[GARMIN_FIX_USER_ID] Updated garmin_user_id:', {
    participant_id: participantId,
    garmin_user_id: garminUserId,
  });

  return NextResponse.json({
    message: 'Garmin user ID saved successfully',
    garmin_user_id: garminUserId,
  });
}
