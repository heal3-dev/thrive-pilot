import { NextResponse } from "next/server";
import { z } from "zod";

import { getInviteRedirect, requireAdmin } from "../_utils";
import { twilioClient, TWILIO_PHONE_NUMBER } from "@/lib/twilio";

const createParticipantSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200).optional(),
  phone_number: z.string().optional(),
  sendInvite: z.boolean().optional(),
});

import { calculateFlags, Metric } from "@/lib/flags/rules";

// ... (rest of imports)

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;

  // Fetch all participants with their current mentor assignment (if any)
  const { data: participantsData, error: participantsError } = await admin
    .from("participants")
    .select(
      "id, name, phone_number, email, is_active, garmin_user_id, consent_given, created_at, updated_at"
    )
    .order("created_at", { ascending: false });

  if (participantsError) {
    return NextResponse.json({ error: "Failed to fetch participants" }, { status: 500 });
  }

  // Fetch active assignments to map mentor names
  const { data: assignmentsData, error: assignmentsError } = await admin
    .from("mentor_assignments")
    .select(`
      participant_id,
      mentor_id,
      assigned_at,
      unassigned_at,
      mentors ( id, name, email )
    `)
    .order("assigned_at", { ascending: false });

  if (assignmentsError) {
    return NextResponse.json({ error: "Failed to fetch assignments" }, { status: 500 });
  }

  // Fetch pseudonym mappings to bridge PII ↔ health data
  const { data: pseudonymData } = await admin
    .from("participant_pseudonyms")
    .select("participant_id, pseudonym_id");

  const participantToPseudonym = new Map<string, string>();
  const pseudonymToParticipant = new Map<string, string>();
  for (const row of pseudonymData ?? []) {
    participantToPseudonym.set(row.participant_id, row.pseudonym_id);
    pseudonymToParticipant.set(row.pseudonym_id, row.participant_id);
  }

  // Fetch active Garmin connections (via pseudonym_id on tokens table)
  const { data: garminTokensData, error: garminTokensError } = await admin
    .from("garmin_tokens")
    .select("pseudonym_id")
    .is("revoked_at", null);

  if (garminTokensError) {
    return NextResponse.json({ error: "Failed to fetch Garmin connections" }, { status: 500 });
  }

  const connectedPseudonymIds = new Set(
    (garminTokensData ?? []).map((token) => token.pseudonym_id)
  );

  // Fetch recent metrics for flagging (last 4 days via pseudonym_id)
  const fourDaysAgo = new Date();
  fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
  const dateStr = fourDaysAgo.toISOString().split('T')[0];

  const { data: metricsData } = await admin
    .from("garmin_metrics")
    .select("pseudonym_id, metric_date, resting_heart_rate, average_stress_level, sleep_duration_seconds, sleep_score, body_battery_charged, body_battery_drained, hrv_last_night_average, hrv_last_night_5_min_high")
    .gte("metric_date", dateStr)
    .order("metric_date", { ascending: false });

  // Map metrics back to participant_id for flag calculation
  const metricsByParticipant = new Map<string, Metric[]>();
  if (metricsData) {
    for (const m of metricsData) {
      const participantId = pseudonymToParticipant.get(m.pseudonym_id);
      if (!participantId) continue;
      if (!metricsByParticipant.has(participantId)) {
        metricsByParticipant.set(participantId, []);
      }
      metricsByParticipant.get(participantId)?.push({
        id: "temp",
        metric_date: m.metric_date,
        resting_heart_rate: m.resting_heart_rate,
        average_stress_level: m.average_stress_level,
        sleep_duration_seconds: m.sleep_duration_seconds,
        sleep_score: m.sleep_score,
        body_battery_charged: m.body_battery_charged,
        body_battery_drained: m.body_battery_drained,
        hrv_last_night_average: m.hrv_last_night_average,
        hrv_last_night_5_min_high: m.hrv_last_night_5_min_high,
      });
    }
  }

  // Create a map of participant_id -> latest assignment
  const assignmentMap = new Map<string, { mentor_id: string; mentor_name: string | null; mentor_email: string | null; assigned_at: string | null; unassigned_at: string | null }>();
  for (const a of assignmentsData ?? []) {
    // Since we ordered by assigned_at desc, we only care about the first one we see for each participant
    if (!assignmentMap.has(a.participant_id)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mentor = a.mentors as any;
      assignmentMap.set(a.participant_id, {
        mentor_id: a.mentor_id,
        mentor_name: mentor?.name ?? null,
        mentor_email: mentor?.email ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assigned_at: (a as any).assigned_at,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        unassigned_at: (a as any).unassigned_at,
      });
    }
  }

  // Enrich participants with mentor info AND flags
  const participants = (participantsData ?? []).map((p) => {
    const pMetrics = metricsByParticipant.get(p.id) || [];
    const flags = calculateFlags(pMetrics);

    return {
      ...p,
      garmin_connected:
        Boolean(p.garmin_user_id) || connectedPseudonymIds.has(participantToPseudonym.get(p.id) ?? ''),
      assigned_mentor: assignmentMap.get(p.id) ?? null,
      flags, // Attach flags
    };
  });

  // ── Fetch Supabase Auth users invited as participants but not yet in the participants table ──
  const participantIds = new Set((participantsData ?? []).map((p) => p.id));

  let unverifiedParticipants: typeof participants = [];
  try {
    // listUsers paginates; fetch up to a reasonable page size
    const { data: authList, error: authListError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (!authListError && authList?.users) {
      unverifiedParticipants = authList.users
        .filter((u) => {
          const meta = u.user_metadata as Record<string, unknown> | undefined;
          return meta?.role === "participant" && !participantIds.has(u.id);
        })
        .map((u) => {
          const meta = u.user_metadata as Record<string, unknown> | undefined;
          return {
            id: u.id,
            name: (meta?.name as string) ?? null,
            phone_number: (meta?.phone_number as string) ?? "",
            email: u.email ?? null,
            is_active: false,
            garmin_user_id: null,
            consent_given: false,
            consent_timestamp: null,
            created_at: u.created_at,
            updated_at: u.updated_at,
            garmin_connected: false,
            is_unverified: true,
            assigned_mentor: null,
            flags: [], // No flags for unverified
          };
        });
    }
  } catch (e) {
    // Non-fatal: log and continue without unverified users
    console.error("[PARTICIPANTS] Failed to fetch auth users for unverified list", e);
  }

  const allParticipants = [...participants, ...unverifiedParticipants];

  // Provide mentor list for filtering / display
  const { data: mentors, error: mentorsError } = await admin
    .from("mentors")
    .select("id, name, email, role, is_active, created_at")
    .neq("role", "admin")
    .order("created_at", { ascending: false });

  if (mentorsError) {
    return NextResponse.json({ error: "Failed to fetch mentors" }, { status: 500 });
  }

  return NextResponse.json({ participants: allParticipants, mentors: mentors ?? [] });
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;

  let payload: z.infer<typeof createParticipantSchema>;
  try {
    payload = createParticipantSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Check for duplicate email in participants
  if (payload.email) {
    const { data: existingEmail } = await admin
      .from("participants")
      .select("id")
      .eq("email", payload.email)
      .limit(1)
      .maybeSingle();

    if (existingEmail?.id) {
      return NextResponse.json({ error: "This email is already registered as a participant" }, { status: 409 });
    }

    // Check if email exists in mentors table
    const { data: existingMentor } = await admin
      .from("mentors")
      .select("id")
      .eq("email", payload.email)
      .limit(1)
      .maybeSingle();

    if (existingMentor?.id) {
      return NextResponse.json({ error: "This email is already registered as a mentor" }, { status: 409 });
    }
  }

  // Check for duplicate phone number
  if (payload.phone_number) {
    const { data: existingPhone } = await admin
      .from("participants")
      .select("id")
      .eq("phone_number", payload.phone_number)
      .limit(1)
      .maybeSingle();

    if (existingPhone?.id) {
      return NextResponse.json({ error: "A participant with this phone number already exists" }, { status: 409 });
    }
  }
  // When adding directly (no invite), consent is implied
  // When inviting, consent is captured via consent page
  const shouldSendInvite = payload.sendInvite !== false;
  const consentGiven = !shouldSendInvite; // Direct add = consent given
  const consentTimestamp = consentGiven ? new Date().toISOString() : null;

  const { data, error } = await admin
    .from("participants")
    .insert({
      email: payload.email,
      name: payload.name || null,
      phone_number: payload.phone_number || "",
      is_active: true,
      consent_given: consentGiven,
      consent_timestamp: consentTimestamp,
    })
    .select("id, name, phone_number, email, is_active, consent_given, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create participant" }, { status: 500 });
  }

  // Email invitation (best-effort): relies on Supabase Auth email settings.
  let inviteSent = false;
  let inviteError: string | null = null;
  let inviteErrorStatus: number | null = null;

  if (shouldSendInvite) {
    const { redirectTo, source } = getInviteRedirect(request);
    try {
      const { data: inviteData, error: authError } = await admin.auth.admin.inviteUserByEmail(
        payload.email,
        {
          ...(redirectTo ? { redirectTo } : {}),
        }
      );

      if (authError) {
        console.error("[INVITE] Supabase invite failed", {
          email: payload.email,
          redirectTo,
          redirectSource: source,
          error: authError,
        });
        inviteError = authError.message;
        inviteErrorStatus = authError.status ?? null;
      } else {
        inviteSent = true;
        console.info("[INVITE] Supabase invite created", {
          email: payload.email,
          redirectTo,
          redirectSource: source,
          userId: inviteData?.user?.id ?? null,
        });

        // Send Welcome SMS
        if (payload.phone_number && TWILIO_PHONE_NUMBER) {
          try {
            const messageBody = `Hi ${payload.name || "there"}, you've been invited to Thrive Pilot. Please check your email ${payload.email} to accept the invitation.`;
            await twilioClient.messages.create({
              to: payload.phone_number,
              from: TWILIO_PHONE_NUMBER,
              body: messageBody,
            });
            console.info("[INVITE] Welcome SMS sent", { phone: payload.phone_number });
          } catch (smsError) {
            console.error("[INVITE] Failed to send Welcome SMS", smsError);
            // Don't fail the request, just log it
          }
        }
      }
    } catch (e) {
      console.error("[INVITE] Supabase invite threw", {
        email: payload.email,
        redirectTo,
        redirectSource: source,
        error: e,
      });
      inviteError = e instanceof Error ? e.message : "Failed to send invite";
    }
  }

  return NextResponse.json(
    {
      participant: data,
      inviteSent,
      ...(inviteError ? { inviteError } : {}),
      ...(inviteErrorStatus ? { inviteErrorStatus } : {}),
    },
    { status: 201 }
  );
}
