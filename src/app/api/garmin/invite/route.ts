import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/app/api/admin/_utils';
import { sendEmail } from '@/lib/email/send';
import { garminInviteTemplate } from '@/lib/email/templates/garmin-invite';

const inviteSchema = z.object({
  participant_id: z.string().uuid(),
  email: z.string().email(),
});

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  
  const admin = guard.admin;
  
  // Parse request
  let payload: z.infer<typeof inviteSchema>;
  try {
    payload = inviteSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  
  // 1. Verify participant exists
  const { data: participant, error: participantError } = await admin
    .from('participants')
    .select('id, name, email')
    .eq('id', payload.participant_id)
    .single();
    
  if (participantError || !participant) {
    console.error('[GARMIN_INVITE] Participant lookup error:', participantError?.message);
    return NextResponse.json({ error: 'Participant not found' }, { status: 404 });
  }

  if (!participant.email || participant.email.toLowerCase() !== payload.email.toLowerCase()) {
    return NextResponse.json({ error: 'Participant email does not match request' }, { status: 400 });
  }
  
  // 2. Check if already connected
  const { data: existingToken } = await admin
    .from('garmin_tokens')
    .select('id')
    .eq('participant_id', payload.participant_id)
    .is('revoked_at', null)
    .maybeSingle();
    
  if (existingToken) {
    return NextResponse.json(
      { error: 'Garmin already connected for this participant' },
      { status: 400 }
    );
  }
  
  // 3. Rate limit: max 3 invites per day (check audit_logs)
  const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
  const { data: recentInvites } = await admin
    .from('audit_logs')
    .select('id')
    .eq('action', 'garmin_invite_sent')
    .eq('record_id', payload.participant_id)
    .gte('created_at', oneDayAgo);
    
  if ((recentInvites?.length ?? 0) >= 3) {
    return NextResponse.json(
      { error: 'Too many invites sent today. Please try again tomorrow.' },
      { status: 429 }
    );
  }
  
  // 4. Generate magic link (24h expiry)
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: participant.email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/garmin/connect`,
      data: {
        participant_id: payload.participant_id,
        action: 'garmin_connect',
      },
    },
  });
  
  if (linkError || !linkData) {
    console.error('[GARMIN_INVITE] Failed to generate magic link:', linkError);
    return NextResponse.json(
      { error: 'Failed to generate invite link' },
      { status: 500 }
    );
  }

  const actionLink = linkData.properties.action_link;
  if (!actionLink) {
    return NextResponse.json(
      { error: 'Invite link was not generated' },
      { status: 500 }
    );
  }
  
  // 5. Send email
  const expiresAt = new Date(Date.now() + 86400000); // 24 hours
  try {
    await sendEmail({
      to: participant.email,
      subject: 'Connect Your Garmin to Thrive Pilot',
      html: garminInviteTemplate({
        name: participant.name || 'there',
        link: actionLink,
        expiresIn: '24 hours',
      }),
    });
  } catch (emailError) {
    console.error('[GARMIN_INVITE] Failed to send Garmin invite email:', emailError);
    return NextResponse.json(
      { error: 'Failed to send Garmin invite email' },
      { status: 500 }
    );
  }
  
  // 6. Get authenticated user for audit log
  const { data: sessionData } = await admin.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  
  // 7. Audit log
  await admin.from('audit_logs').insert({
    user_id: userId,
    action: 'garmin_invite_sent',
    table_name: 'garmin_tokens',
    record_id: payload.participant_id,
    metadata: {
      participant_email: participant.email,
      expires_at: expiresAt.toISOString(),
    },
  });
  
  return NextResponse.json({
    success: true,
    expires_at: expiresAt.toISOString(),
    message: `Invite sent to ${participant.email}`,
  });
}
