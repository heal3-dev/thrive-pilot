
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/_utils";
import { computeWeeklyFlagFromMetrics, type Metric, type WeeklyFlag } from "@/lib/flags/rules";
import { hashParticipantId } from "@/lib/pseudonym-crypto";
import * as Sentry from "@sentry/nextjs";
import { toE164 } from "@/lib/utils";

function ymdAddDays(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const supabase = guard.admin;
  const { id } = await params;

  // 1. Fetch Participant (PII zone)
  const { data: participant, error: pError } = await supabase
    .from("participants")
    .select("id, name, email, phone_number, garmin_user_id, garmin_connected_at, weekly_report_sms_enabled, weekly_report_email_enabled")
    .eq("id", id)
    .single();

  if (pError) {
    console.error("Error fetching participant:", pError);
    return NextResponse.json({ error: "Failed to fetch participant" }, { status: 500 });
  }

  if (!participant) {
    return NextResponse.json({ error: "Participant not found" }, { status: 404 });
  }

  // 2. Resolve pseudonym_id via HMAC hash
  const pidHash = hashParticipantId(id);
  const { data: pseudonymRow } = await supabase
    .from("participant_pseudonyms")
    .select("pseudonym_id")
    .eq("participant_id_hash", pidHash)
    .maybeSingle();

  const pseudonymId = pseudonymRow?.pseudonym_id;

  // 3. Check Garmin connection (via pseudonym on tokens table)
  let isConnected = Boolean(participant.garmin_user_id);
  if (!isConnected && pseudonymId) {
    const { data: tokenData } = await supabase
      .from("garmin_tokens")
      .select("pseudonym_id")
      .eq("pseudonym_id", pseudonymId)
      .is("revoked_at", null)
      .maybeSingle();
    isConnected = Boolean(tokenData);
  }

  // 4. Fetch Metrics via pseudonym_id (supports pagination)
  const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0", 10);
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "30", 10);
  const clampedLimit = Math.min(Math.max(limit, 1), 100);

  let metricsData: Record<string, unknown>[] = [];
  let totalCount = 0;
  if (pseudonymId) {
    // Get total count for pagination
    const { count } = await supabase
      .from("garmin_metrics")
      .select("id", { count: "exact", head: true })
      .eq("pseudonym_id", pseudonymId);
    totalCount = count ?? 0;

    const { data: metrics, error: mError } = await supabase
      .from("garmin_metrics")
      .select("id, metric_date, resting_heart_rate, average_stress_level, sleep_duration_seconds, sleep_score, awake_seconds, body_battery_charged, body_battery_drained, body_battery_start, body_battery_highest, body_battery_lowest, body_battery_most_recent, hrv_last_night_average, hrv_last_night_5_min_high")
      .eq("pseudonym_id", pseudonymId)
      .order("metric_date", { ascending: false })
      .range(offset, offset + clampedLimit - 1);

    if (mError) {
      console.error(`[PARTICIPANT_DETAILS] Error fetching metrics:`, mError);
    }
    metricsData = (metrics || []).map((m) => {
      const mm = m as unknown as { body_battery_start?: number | null; body_battery_highest?: number | null };
      return {
        ...m,
        // Use daily peak as the "morning start" proxy (fixes historic data too).
        body_battery_start: mm.body_battery_highest ?? mm.body_battery_start ?? null,
      };
    });
  }

  const todayYmd = new Date().toISOString().slice(0, 10);
  const inferredWeekEndingFromPage =
    offset === 0 && metricsData.length > 0
      ? ((metricsData[0] as unknown as { metric_date?: string }).metric_date ?? null)
      : null;
  const weekEnding = inferredWeekEndingFromPage ?? todayYmd;
  let weekly_flag: WeeklyFlag | null = null;
  if (offset === 0 && pseudonymId) {
    const since = ymdAddDays(weekEnding, -40);
    const { data: weeklyMetrics } = await supabase
      .from("garmin_metrics")
      .select(
        "id, metric_date, resting_heart_rate, average_stress_level, sleep_duration_seconds, sleep_score, awake_seconds, body_battery_charged, body_battery_drained, body_battery_start, body_battery_highest, body_battery_lowest, body_battery_most_recent, hrv_last_night_average, hrv_last_night_5_min_high"
      )
      .eq("pseudonym_id", pseudonymId)
      .gte("metric_date", since)
      .lte("metric_date", weekEnding)
      .order("metric_date", { ascending: false });

    const inferredWeekEnding =
      (weeklyMetrics?.[0]?.metric_date as string | undefined) ?? weekEnding;
    const weeklyTyped: Metric[] = (weeklyMetrics ?? []).map((m) => ({
      // Prefer daily peak as "start" for scoring and display semantics.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body_battery_start: ((m as any).body_battery_highest ?? (m as any).body_battery_start) as number | null,
      id: m.id as string,
      metric_date: m.metric_date as string,
      resting_heart_rate: m.resting_heart_rate as number | null,
      average_stress_level: m.average_stress_level as number | null,
      sleep_duration_seconds: m.sleep_duration_seconds as number | null,
      sleep_score: m.sleep_score as number | null,
      awake_seconds: (m as unknown as { awake_seconds?: number | null }).awake_seconds ?? null,
      body_battery_charged: m.body_battery_charged as number | null,
      body_battery_drained: m.body_battery_drained as number | null,
      body_battery_lowest: m.body_battery_lowest as number | null,
      body_battery_most_recent: m.body_battery_most_recent as number | null,
      hrv_last_night_average: m.hrv_last_night_average as number | null,
      hrv_last_night_5_min_high: m.hrv_last_night_5_min_high as number | null,
    }));

    weekly_flag = computeWeeklyFlagFromMetrics(weeklyTyped, inferredWeekEnding);
  }

  return NextResponse.json({
    participant,
    is_connected: isConnected,
    metrics: metricsData,
    weekly_flag,
    pagination: { offset, limit: clampedLimit, total: totalCount, hasMore: offset + clampedLimit < totalCount },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;
  const { id } = await params;

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const allowedKeys = new Set(["name", "email", "phone_number", "is_active", "weekly_report_sms_enabled", "weekly_report_email_enabled"]);
  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!allowedKeys.has(k)) continue;
    update[k] = v;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
  }

  try {
    // Normalize phone number to E.164 (Twilio requires E.164).
    // We accept basic formats but persist consistently.
    if (Object.prototype.hasOwnProperty.call(update, "phone_number")) {
      const raw = update.phone_number;
      if (raw === null || raw === undefined || raw === "") {
        update.phone_number = null;
      } else if (typeof raw === "string") {
        const normalized = toE164(raw);
        if (!normalized) {
          return NextResponse.json(
            { error: "Invalid phone number. Use E.164 (+15551234567) or a basic 10-digit format." },
            { status: 400 }
          );
        }
        update.phone_number = normalized;
      } else {
        return NextResponse.json({ error: "Invalid phone_number value" }, { status: 400 });
      }
    }

    const { data: existingParticipant, error: existingParticipantError } = await admin
      .from("participants")
      .select("id, email")
      .eq("id", id)
      .maybeSingle();

    if (existingParticipantError) {
      return NextResponse.json({ error: existingParticipantError.message }, { status: 500 });
    }

    if (!existingParticipant?.id) {
      return NextResponse.json({ error: "Participant not found" }, { status: 404 });
    }

    // Some participant rows are linked to Supabase Auth by matching UUIDs (invite/consent flow),
    // but direct-created participants may not have an auth user at all. We'll try to resolve
    // a corresponding auth user id to (a) exclude "self" in uniqueness checks and (b) update
    // auth email when changing participant email so the old email is released.
    let participantAuthUserId: string | null = null;

    // Normalize email for comparisons and uniqueness checks.
    const requestedEmailRaw = Object.prototype.hasOwnProperty.call(update, "email")
      ? update.email
      : undefined;
    const requestedEmail =
      typeof requestedEmailRaw === "string" ? requestedEmailRaw.trim() : requestedEmailRaw;

    const existingEmailLower = (existingParticipant.email ?? "").toLowerCase();
    const requestedEmailLower =
      typeof requestedEmail === "string" ? requestedEmail.toLowerCase() : null;

    const isEmailChange =
      typeof requestedEmail === "string" &&
      requestedEmail.length > 0 &&
      requestedEmailLower !== existingEmailLower;

    if (isEmailChange && requestedEmailLower) {
      // Prefer resolving auth user by participant UUID (invite/consent flow).
      const { data: authById, error: authByIdError } = await admin.auth.admin.getUserById(id);
      if (!authByIdError && authById?.user) {
        participantAuthUserId = id;
      }

      // Check for duplicate email in participants (excluding this participant).
      const { data: dupParticipant, error: dupParticipantError } = await admin
        .from("participants")
        .select("id")
        .eq("email", requestedEmail)
        .neq("id", id)
        .limit(1)
        .maybeSingle();

      if (dupParticipantError) {
        return NextResponse.json({ error: dupParticipantError.message }, { status: 500 });
      }

      if (dupParticipant?.id) {
        return NextResponse.json({ error: "This email is already registered as a participant" }, { status: 409 });
      }

      // Check if email exists in mentors table.
      const { data: dupMentor, error: dupMentorError } = await admin
        .from("mentors")
        .select("id")
        .eq("email", requestedEmail)
        .limit(1)
        .maybeSingle();

      if (dupMentorError) {
        return NextResponse.json({ error: dupMentorError.message }, { status: 500 });
      }

      if (dupMentor?.id) {
        return NextResponse.json({ error: "This email is already registered as a mentor" }, { status: 409 });
      }

      // Check Supabase Auth users (covers invited-but-not-consented users and any other auth accounts).
      const perPage = 1000;
      let page = 1;
      const requestedMatches: string[] = [];
      while (true) {
        const { data: listData, error: listError } = await admin.auth.admin.listUsers({
          page,
          perPage,
        });
        if (listError) {
          return NextResponse.json({ error: listError.message }, { status: 500 });
        }

        const users = listData?.users ?? [];
        for (const u of users) {
          const emailLower = (u.email ?? "").toLowerCase();
          if (!participantAuthUserId && existingEmailLower && emailLower === existingEmailLower) {
            const meta = u.user_metadata as Record<string, unknown> | undefined;
            if (u.id === id || meta?.role === "participant") {
              participantAuthUserId = u.id;
            }
          }

          if (emailLower === requestedEmailLower) {
            requestedMatches.push(u.id);
          }
        }

        if (users.length < perPage) {
          break;
        }
        page += 1;
        if (page > 20) break; // Safety: avoid unbounded loops
      }

      const selfAuthId = participantAuthUserId;
      const authEmailTaken = requestedMatches.some((matchId) => matchId !== selfAuthId);
      if (authEmailTaken) {
        return NextResponse.json({ error: "This email is already registered in the system" }, { status: 409 });
      }
    }

    // If we are changing email, also update the linked Supabase Auth user (if it exists),
    // so the old email is released for reuse (e.g., creating a mentor).
    let authUpdated = false;
    let oldAuthEmail: string | null = null;
    if (isEmailChange && typeof requestedEmail === "string") {
      const targetAuthUserId = participantAuthUserId;
      if (targetAuthUserId) {
        const { data: authData, error: authGetError } = await admin.auth.admin.getUserById(targetAuthUserId);
        if (authGetError || !authData?.user) {
          return NextResponse.json({ error: "Failed to load auth user for participant" }, { status: 500 });
        }

        oldAuthEmail = authData.user.email ?? null;
        const { error: authUpdateError } = await admin.auth.admin.updateUserById(targetAuthUserId, {
          email: requestedEmail,
          email_confirm: true,
        });

        if (authUpdateError) {
          const msg = authUpdateError.message ?? "Failed to update auth user";
          const lower = msg.toLowerCase();
          if (lower.includes("already") || lower.includes("registered") || lower.includes("exists")) {
            return NextResponse.json({ error: "This email is already registered in the system" }, { status: 409 });
          }
          return NextResponse.json({ error: msg }, { status: 500 });
        }
        authUpdated = true;
      }
    }

    const { data: updated, error } = await admin
      .from("participants")
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, name, email, phone_number, is_active, garmin_user_id, created_at, updated_at")
      .single();

    if (error) {
      // Compensate: if we updated the auth email but failed to update the participant row,
      // attempt to revert the auth email to its previous value.
      if (authUpdated && oldAuthEmail) {
        const targetAuthUserId = participantAuthUserId;
        const { error: revertError } = targetAuthUserId
          ? await admin.auth.admin.updateUserById(targetAuthUserId, {
          email: oldAuthEmail,
          email_confirm: true,
        })
          : { error: null };
        if (revertError) {
          Sentry.captureMessage("Auth email updated but participant update failed; revert failed", {
            level: "warning",
            extra: { participant_id: id, revertError: revertError.message, oldAuthEmail },
          });
        }
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If deactivating, end any active mentor assignment(s).
    if (update.is_active === false) {
      const { error: unassignError } = await admin
        .from("mentor_assignments")
        .update({ unassigned_at: new Date().toISOString() })
        .eq("participant_id", id)
        .is("unassigned_at", null);

      if (unassignError) {
        // Participant update succeeded, but assignment update failed. Capture for follow-up.
        Sentry.captureMessage("Participant deactivated but assignment unassign failed", {
          level: "warning",
          extra: { participant_id: id, error: unassignError.message },
        });
      }
    }

    return NextResponse.json({ participant: updated });
  } catch (e) {
    Sentry.captureException(e, { extra: { participant_id: id, payload: update } });
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;
  const { id } = await params;

  // Safety: never delete a real participant row via this endpoint.
  const { data: participant } = await admin
    .from("participants")
    .select("id")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (participant?.id) {
    return NextResponse.json(
      { error: "Cannot delete an active participant via this endpoint" },
      { status: 400 }
    );
  }

  // Only allow deleting invite-only participant auth users.
  const { data: authData, error: getUserError } = await admin.auth.admin.getUserById(id);
  if (getUserError || !authData?.user) {
    return NextResponse.json({ error: "Auth user not found" }, { status: 404 });
  }

  const meta = authData.user.user_metadata as Record<string, unknown> | undefined;
  if (meta?.role !== "participant") {
    return NextResponse.json(
      { error: "This user is not a participant invite" },
      { status: 400 }
    );
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(id);
  if (deleteError) {
    Sentry.captureException(deleteError, { extra: { auth_user_id: id } });
    return NextResponse.json({ error: "Failed to delete invited user" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
