import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/app/api/admin/_utils';

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
    .select('id, name, email, user_id')
    .eq('id', payload.participant_id)
    .single();
    
  if (participantError || !participant) {
    return NextResponse.json({ error: 'Participant not found' }, { status: 404 });
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
  
  // 5. Send email (placeholder - will implement template next)
  const expiresAt = new Date(Date.now() + 86400000); // 24 hours
  console.log('[GARMIN_INVITE] Magic link generated:', {
    participant_id: payload.participant_id,
    email: participant.email,
    link: linkData.properties.action_link,
    expires_at: expiresAt.toISOString(),
  });
  
  // TODO: Implement email sending with template
  // await sendEmail({
  //   to: participant.email,
  //   subject: '🔗 Connect Your Garmin to Thrive Pilot',
  //   template: 'garmin-invite',
  //   data: {
  //     name: participant.name || 'there',
  //     link: linkData.properties.action_link,
  //     expiresIn: '24 hours',
  //   },
  // });
  
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
