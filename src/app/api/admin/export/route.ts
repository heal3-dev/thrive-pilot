import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAdmin } from "@/app/api/admin/_utils";
import { decryptParticipantId, hashParticipantId } from "@/lib/pseudonym-crypto";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

export type ExportCategory =
  | "biometrics"
  | "messages"
  | "participants"
  | "assignments"
  | "mentors"
  | "weekly_reports"
  | "monthly_reports"
  | "audit_logs";

const VALID_CATEGORIES = new Set<ExportCategory>([
  "biometrics",
  "messages",
  "participants",
  "assignments",
  "mentors",
  "weekly_reports",
  "monthly_reports",
  "audit_logs",
]);

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str: string;
  if (typeof value === "object") {
    try {
      str = JSON.stringify(value);
    } catch {
      str = String(value);
    }
  } else {
    str = String(value);
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const header = columns.map(escapeCsvCell).join(",");
  const lines = rows.map((row) => columns.map((col) => escapeCsvCell(row[col])).join(","));
  // Include UTF-8 BOM so Microsoft Excel renders emojis/accents/em-dashes properly
  return "\uFEFF" + [header, ...lines].join("\r\n");
}

function hrvCvPercent(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return null;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  const stdev = Math.sqrt(variance);
  return (stdev / mean) * 100;
}

function formatBodyBatteryCell(m: Record<string, unknown>): string {
  const start = (m.body_battery_start ?? m.body_battery_highest) as number | null | undefined;
  const low = m.body_battery_lowest as number | null | undefined;
  const recent = m.body_battery_most_recent as number | null | undefined;
  const charged = m.body_battery_charged as number | null | undefined;
  const drained = m.body_battery_drained as number | null | undefined;

  if (start != null || low != null || recent != null) {
    const chain = `${start ?? "—"}→${low ?? "—"}→${recent ?? "—"}`;
    if (charged != null || drained != null) {
      return `${chain} (+${charged ?? 0} / -${Math.abs(drained ?? 0)})`;
    }
    return chain;
  }
  if (charged != null || drained != null) {
    return `+${charged ?? 0} / -${Math.abs(drained ?? 0)}`;
  }
  return "-";
}

/**
 * Paginate through a Supabase table in 1,000-row batches so exports aren't truncated
 * by PostgREST's default 1,000-row limit.
 */
async function fetchAllRows<T = Record<string, unknown>>(params: {
  admin: SupabaseClient;
  table: string;
  select?: string;
  orderBy?: { column: string; ascending?: boolean };
  secondaryOrderBy?: { column: string; ascending?: boolean };
}): Promise<T[]> {
  const pageSize = 1000;
  const all: T[] = [];
  let offset = 0;

  while (true) {
    let query = params.admin
      .from(params.table)
      .select(params.select ?? "*")
      .range(offset, offset + pageSize - 1);

    if (params.orderBy) {
      query = query.order(params.orderBy.column, {
        ascending: params.orderBy.ascending ?? true,
      });
    }
    if (params.secondaryOrderBy) {
      query = query.order(params.secondaryOrderBy.column, {
        ascending: params.secondaryOrderBy.ascending ?? true,
      });
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to query ${params.table}: ${error.message}`);
    }

    const batch = (data ?? []) as unknown as T[];
    all.push(...batch);

    if (batch.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  return all;
}

type ParticipantInfo = {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  garmin_user_id: string | null;
  is_active: boolean | null;
  consent_given: boolean | null;
  consent_timestamp: string | null;
  weekly_report_sms_enabled?: boolean | null;
  weekly_report_email_enabled?: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

type MentorInfo = {
  id: string;
  user_id: string | null;
  name: string | null;
  email: string | null;
  role: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

/**
 * Builds bidirectional lookup maps between participant_id and pseudonym_id,
 * using PSEUDONYM_ENCRYPTION_KEY when available.
 */
async function buildParticipantAndPseudonymMaps(admin: SupabaseClient): Promise<{
  participantById: Map<string, ParticipantInfo>;
  pseudonymToParticipantId: Map<string, string>;
  participantIdToPseudonym: Map<string, string>;
}> {
  const participants = await fetchAllRows<ParticipantInfo>({
    admin,
    table: "participants",
    select: "*",
    orderBy: { column: "created_at", ascending: true },
  });

  const participantById = new Map<string, ParticipantInfo>();
  const hashToParticipantId = new Map<string, string>();
  const hasEncryptionKey = Boolean(process.env.PSEUDONYM_ENCRYPTION_KEY);

  for (const p of participants) {
    participantById.set(p.id, p);
    if (hasEncryptionKey) {
      try {
        hashToParticipantId.set(hashParticipantId(p.id), p.id);
      } catch {
        // Ignore hash errors if key is malformed
      }
    }
  }

  const pseudonymToParticipantId = new Map<string, string>();
  const participantIdToPseudonym = new Map<string, string>();

  try {
    const pseudonyms = await fetchAllRows<{
      pseudonym_id: string;
      participant_id?: string | null;
      participant_id_hash?: string | null;
      participant_id_encrypted?: string | null;
    }>({
      admin,
      table: "participant_pseudonyms",
      select: "*",
    });

    for (const row of pseudonyms) {
      if (!row.pseudonym_id) continue;
      let resolvedParticipantId: string | null = null;

      if (typeof row.participant_id === "string" && row.participant_id) {
        resolvedParticipantId = row.participant_id;
      } else if (row.participant_id_hash && hashToParticipantId.has(row.participant_id_hash)) {
        resolvedParticipantId = hashToParticipantId.get(row.participant_id_hash) ?? null;
      } else if (hasEncryptionKey && row.participant_id_encrypted) {
        try {
          resolvedParticipantId = decryptParticipantId(row.participant_id_encrypted);
        } catch {
          resolvedParticipantId = null;
        }
      }

      if (resolvedParticipantId) {
        pseudonymToParticipantId.set(row.pseudonym_id, resolvedParticipantId);
        participantIdToPseudonym.set(resolvedParticipantId, row.pseudonym_id);
      }
    }
  } catch {
    // If participant_pseudonyms table doesn't exist in dev, continue gracefully
  }

  return { participantById, pseudonymToParticipantId, participantIdToPseudonym };
}

function compareByParticipantThenDateDesc(
  a: { participantName: string; participantKey: string; dateStr: string },
  b: { participantName: string; participantKey: string; dateStr: string }
): number {
  const aHasName = a.participantName.trim().length > 0;
  const bHasName = b.participantName.trim().length > 0;
  if (aHasName && !bHasName) return -1;
  if (!aHasName && bHasName) return 1;

  const nameCmp = a.participantName.localeCompare(b.participantName, undefined, {
    sensitivity: "base",
  });
  if (nameCmp !== 0) return nameCmp;

  const keyCmp = a.participantKey.localeCompare(b.participantKey);
  if (keyCmp !== 0) return keyCmp;

  return b.dateStr.localeCompare(a.dateStr);
}

/**
 * Excel on Windows renders colored-circle emoji (🟢🟡🟠🔴) in monochrome, so exports
 * include a plain-text color name alongside the stored emoji.
 */
function badgeColorName(icon: unknown, label?: unknown): string {
  const s = typeof icon === "string" ? icon : "";
  if (s.includes("🟢")) return "Green";
  if (s.includes("🟡")) return "Yellow";
  if (s.includes("🟠")) return "Orange";
  if (s.includes("🔴")) return "Red";
  if (s.includes("⚪")) return "Grey";
  const l = typeof label === "string" ? label.toLowerCase() : "";
  if (/\bgreen\b/.test(l)) return "Green";
  if (/\byellow\b/.test(l)) return "Yellow";
  if (/\borange\b/.test(l)) return "Orange";
  if (/\bred\b/.test(l)) return "Red";
  return "";
}

function buildParticipantSlug(pInfo: ParticipantInfo | undefined, fallbackId: string): string {
  return (
    (pInfo?.name || pInfo?.email || fallbackId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "participant"
  );
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const categoryParam = (url.searchParams.get("category") ?? "").trim() as ExportCategory;
  const participantIdFilter = (url.searchParams.get("participantId") ?? "").trim() || null;

  if (!VALID_CATEGORIES.has(categoryParam)) {
    return NextResponse.json(
      {
        error: `Invalid or missing category. Valid categories: ${Array.from(VALID_CATEGORIES).join(", ")}`,
      },
      { status: 400 }
    );
  }

  const admin = guard.admin;
  const dateStamp = new Date().toISOString().slice(0, 10);

  try {
    let csv = "";
    let filename = `thrive-${categoryParam}-${dateStamp}.csv`;

    if (categoryParam === "biometrics") {
      const { participantById, pseudonymToParticipantId, participantIdToPseudonym } =
        await buildParticipantAndPseudonymMaps(admin);

      let filterPseudonymId: string | null = null;
      if (participantIdFilter) {
        filterPseudonymId = participantIdToPseudonym.get(participantIdFilter) ?? null;
        const pInfo = participantById.get(participantIdFilter);
        filename = `thrive-biometrics-${buildParticipantSlug(pInfo, participantIdFilter)}-${dateStamp}.csv`;
      }

      const allMetrics = await fetchAllRows<Record<string, unknown>>({
        admin,
        table: "garmin_metrics",
        select: [
          "id",
          "pseudonym_id",
          "metric_date",
          "resting_heart_rate",
          "min_heart_rate",
          "max_heart_rate",
          "average_heart_rate",
          "hrv_value",
          "hrv_weekly_average",
          "hrv_last_night",
          "hrv_last_night_average",
          "hrv_last_night_5_min_high",
          "hrv_status",
          "average_stress_level",
          "max_stress_level",
          "stress_qualifier",
          "stress_duration_seconds",
          "rest_stress_duration_seconds",
          "activity_stress_duration_seconds",
          "low_stress_duration_seconds",
          "medium_stress_duration_seconds",
          "high_stress_duration_seconds",
          "sleep_duration_seconds",
          "deep_sleep_seconds",
          "light_sleep_seconds",
          "rem_sleep_seconds",
          "awake_seconds",
          "sleep_score",
          "sleep_score_qualifier",
          "sleep_validation",
          "sleep_start_time",
          "body_battery_start",
          "body_battery_highest",
          "body_battery_lowest",
          "body_battery_most_recent",
          "body_battery_charged",
          "body_battery_drained",
          "steps",
          "steps_goal",
          "distance_meters",
          "active_time_seconds",
          "duration_seconds",
          "floors_climbed",
          "intensity_minutes_moderate",
          "intensity_minutes_vigorous",
          "active_calories",
          "bmr_calories",
          "total_calories",
          "spo2_average",
          "spo2_lowest",
          "avg_waking_respiration",
          "highest_respiration",
          "lowest_respiration",
          "created_at",
          "updated_at",
        ].join(", "),
        orderBy: { column: "metric_date", ascending: false },
        secondaryOrderBy: { column: "pseudonym_id", ascending: true },
      });

      const metrics = participantIdFilter
        ? allMetrics.filter((m) => filterPseudonymId && m.pseudonym_id === filterPseudonymId)
        : allMetrics;

      // Group metrics by pseudonym_id (sorted newest-first) to compute rolling 7-night HRV Stability (CV%)
      // matching ParticipantMetricsTable.
      const metricsByPseudonym = new Map<string, Array<Record<string, unknown>>>();
      for (const m of metrics) {
        const pid = typeof m.pseudonym_id === "string" ? m.pseudonym_id : "";
        const list = metricsByPseudonym.get(pid) ?? [];
        list.push(m);
        metricsByPseudonym.set(pid, list);
      }

      const hrvStabilityByMetricId = new Map<string, string>();
      for (const [, pMetrics] of metricsByPseudonym) {
        pMetrics.sort((a, b) => (String(a.metric_date) < String(b.metric_date) ? 1 : -1));
        pMetrics.forEach((m, idx) => {
          const vals: number[] = [];
          for (let j = idx; j < pMetrics.length && vals.length < 7; j++) {
            const v = pMetrics[j]?.hrv_last_night_average;
            if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
          }
          if (vals.length >= 7) {
            const cv = hrvCvPercent(vals);
            if (cv != null && typeof m.id === "string") {
              hrvStabilityByMetricId.set(m.id, `${cv.toFixed(1)}%`);
            }
          }
        });
      }

      // Group by participant first, followed by the exact Daily Metrics UI table columns
      const columns = [
        "Participant Name",
        "Participant Email",
        "Date",
        "Body Battery",
        "Stress",
        "RHR",
        "Sleep Duration",
        "Sleep Score",
        "WASO",
        "HRV",
        "HRV Stability",
        "participant_id",
        "participant_phone",
        "pseudonym_id",
        "body_battery_start",
        "body_battery_highest",
        "body_battery_lowest",
        "body_battery_most_recent",
        "body_battery_charged",
        "body_battery_drained",
        "average_stress_level",
        "max_stress_level",
        "stress_qualifier",
        "resting_heart_rate",
        "min_heart_rate",
        "max_heart_rate",
        "average_heart_rate",
        "sleep_duration_seconds",
        "deep_sleep_seconds",
        "light_sleep_seconds",
        "rem_sleep_seconds",
        "awake_seconds",
        "sleep_score",
        "sleep_score_qualifier",
        "sleep_start_time",
        "hrv_last_night_average",
        "hrv_last_night_5_min_high",
        "hrv_last_night",
        "hrv_weekly_average",
        "hrv_status",
        "steps",
        "steps_goal",
        "distance_meters",
        "active_time_seconds",
        "floors_climbed",
        "intensity_minutes_moderate",
        "intensity_minutes_vigorous",
        "active_calories",
        "bmr_calories",
        "total_calories",
        "spo2_average",
        "spo2_lowest",
        "avg_waking_respiration",
        "highest_respiration",
        "lowest_respiration",
        "created_at",
        "updated_at",
        "id",
      ];

      const rows = metrics
        .map((m) => {
          const pseudonymId = typeof m.pseudonym_id === "string" ? m.pseudonym_id : "";
          const participantId = pseudonymToParticipantId.get(pseudonymId) ?? "";
          const participant = participantId ? participantById.get(participantId) : undefined;
          const sleepDurSec = typeof m.sleep_duration_seconds === "number" ? m.sleep_duration_seconds : null;
          const awakeSec = typeof m.awake_seconds === "number" ? m.awake_seconds : null;
          const stress =
            typeof m.average_stress_level === "number" && m.average_stress_level >= 0
              ? m.average_stress_level
              : "-";
          const hrvAvg = m.hrv_last_night_average != null ? String(m.hrv_last_night_average) : "-";
          const hrvPeak =
            m.hrv_last_night_5_min_high != null ? ` (peak ${m.hrv_last_night_5_min_high})` : "";

          return {
            ...m,
            Date: m.metric_date ?? "",
            "Participant Name": participant?.name ?? "",
            "Participant Email": participant?.email ?? "",
            "Body Battery": formatBodyBatteryCell(m),
            Stress: stress,
            RHR: m.resting_heart_rate ?? "-",
            "Sleep Duration": sleepDurSec ? `${(sleepDurSec / 3600).toFixed(1)}h` : "-",
            "Sleep Score": m.sleep_score ?? "-",
            WASO: sleepDurSec != null && awakeSec != null ? `${Math.round(awakeSec / 60)}m` : "-",
            HRV: hrvAvg !== "-" ? `${hrvAvg}${hrvPeak}` : "-",
            "HRV Stability": (typeof m.id === "string" && hrvStabilityByMetricId.get(m.id)) || "-",
            participant_id: participantId,
            pseudonym_id: pseudonymId,
            participant_phone: participant?.phone_number ?? "",
          };
        })
        .sort((a, b) =>
          compareByParticipantThenDateDesc(
            {
              participantName: String(a["Participant Name"] ?? ""),
              participantKey: String(a.participant_id || a.pseudonym_id || ""),
              dateStr: String(a.Date ?? ""),
            },
            {
              participantName: String(b["Participant Name"] ?? ""),
              participantKey: String(b.participant_id || b.pseudonym_id || ""),
              dateStr: String(b.Date ?? ""),
            }
          )
        );

      csv = toCsv(columns, rows);
    } else if (categoryParam === "messages") {
      const [{ participantById }, mentors, allMessages] = await Promise.all([
        buildParticipantAndPseudonymMaps(admin),
        fetchAllRows<MentorInfo>({ admin, table: "mentors", select: "*" }),
        fetchAllRows<Record<string, unknown>>({
          admin,
          table: "sms_messages",
          select: "*",
          orderBy: { column: "created_at", ascending: false },
        }),
      ]);

      if (participantIdFilter) {
        const pInfo = participantById.get(participantIdFilter);
        filename = `thrive-messages-${buildParticipantSlug(pInfo, participantIdFilter)}-${dateStamp}.csv`;
      }

      const messages = participantIdFilter
        ? allMessages.filter((m) => m.participant_id === participantIdFilter)
        : allMessages;

      const mentorById = new Map(mentors.map((m) => [m.id, m]));

      const columns = [
        "participant_name",
        "participant_email",
        "created_at",
        "direction",
        "message_type",
        "message_body",
        "phone_number",
        "mentor_name",
        "mentor_email",
        "twilio_status",
        "twilio_sid",
        "is_read",
        "sent_at",
        "delivered_at",
        "failed_at",
        "failure_reason",
        "participant_id",
        "mentor_id",
        "updated_at",
        "id",
      ];

      const rows = messages
        .map((msg) => {
          const pid = typeof msg.participant_id === "string" ? msg.participant_id : "";
          const mid = typeof msg.mentor_id === "string" ? msg.mentor_id : "";
          const participant = participantById.get(pid);
          const mentor = mentorById.get(mid);
          return {
            ...msg,
            participant_id: pid,
            created_at: msg.created_at ?? "",
            participant_name: participant?.name ?? "",
            participant_email: participant?.email ?? "",
            mentor_name: mentor?.name ?? "",
            mentor_email: mentor?.email ?? "",
          };
        })
        .sort((a, b) =>
          compareByParticipantThenDateDesc(
            {
              participantName: String(a.participant_name ?? ""),
              participantKey: String(a.participant_id ?? ""),
              dateStr: String(a.created_at ?? ""),
            },
            {
              participantName: String(b.participant_name ?? ""),
              participantKey: String(b.participant_id ?? ""),
              dateStr: String(b.created_at ?? ""),
            }
          )
        );

      csv = toCsv(columns, rows);
    } else if (categoryParam === "participants") {
      const [{ participantById, participantIdToPseudonym }, mentors, assignments] = await Promise.all([
        buildParticipantAndPseudonymMaps(admin),
        fetchAllRows<MentorInfo>({ admin, table: "mentors", select: "*" }),
        fetchAllRows<Record<string, unknown>>({
          admin,
          table: "mentor_assignments",
          select: "*",
          orderBy: { column: "assigned_at", ascending: false },
        }),
      ]);

      if (participantIdFilter) {
        const pInfo = participantById.get(participantIdFilter);
        filename = `thrive-participants-${buildParticipantSlug(pInfo, participantIdFilter)}-${dateStamp}.csv`;
      }

      const mentorById = new Map(mentors.map((m) => [m.id, m]));
      const activeMentorsByParticipant = new Map<string, string[]>();

      for (const a of assignments) {
        if (a.unassigned_at) continue;
        const pid = typeof a.participant_id === "string" ? a.participant_id : "";
        const mid = typeof a.mentor_id === "string" ? a.mentor_id : "";
        if (!pid || !mid) continue;
        const mentor = mentorById.get(mid);
        const label = mentor?.name || mentor?.email || mid;
        const list = activeMentorsByParticipant.get(pid) ?? [];
        list.push(label);
        activeMentorsByParticipant.set(pid, list);
      }

      const columns = [
        "name",
        "email",
        "phone_number",
        "is_active",
        "garmin_connected",
        "garmin_user_id",
        "pseudonym_id",
        "assigned_mentors",
        "consent_given",
        "consent_timestamp",
        "weekly_report_sms_enabled",
        "weekly_report_email_enabled",
        "created_at",
        "updated_at",
        "id",
      ];

      const participantsList = participantIdFilter
        ? Array.from(participantById.values()).filter((p) => p.id === participantIdFilter)
        : Array.from(participantById.values());

      const rows = participantsList
        .map((p) => ({
          ...p,
          garmin_connected: Boolean(p.garmin_user_id),
          pseudonym_id: participantIdToPseudonym.get(p.id) ?? "",
          assigned_mentors: (activeMentorsByParticipant.get(p.id) ?? []).join("; "),
        }))
        .sort((a, b) =>
          compareByParticipantThenDateDesc(
            {
              participantName: String(a.name ?? ""),
              participantKey: String(a.id ?? ""),
              dateStr: String(a.created_at ?? ""),
            },
            {
              participantName: String(b.name ?? ""),
              participantKey: String(b.id ?? ""),
              dateStr: String(b.created_at ?? ""),
            }
          )
        );

      csv = toCsv(columns, rows);
    } else if (categoryParam === "assignments") {
      const [{ participantById }, mentors, allAssignments] = await Promise.all([
        buildParticipantAndPseudonymMaps(admin),
        fetchAllRows<MentorInfo>({ admin, table: "mentors", select: "*" }),
        fetchAllRows<Record<string, unknown>>({
          admin,
          table: "mentor_assignments",
          select: "*",
          orderBy: { column: "assigned_at", ascending: false },
        }),
      ]);

      if (participantIdFilter) {
        const pInfo = participantById.get(participantIdFilter);
        filename = `thrive-assignments-${buildParticipantSlug(pInfo, participantIdFilter)}-${dateStamp}.csv`;
      }

      const assignments = participantIdFilter
        ? allAssignments.filter((a) => a.participant_id === participantIdFilter)
        : allAssignments;

      const mentorById = new Map(mentors.map((m) => [m.id, m]));

      const columns = [
        "participant_name",
        "participant_email",
        "participant_phone",
        "status",
        "mentor_name",
        "mentor_email",
        "assigned_at",
        "unassigned_at",
        "participant_id",
        "mentor_id",
        "id",
      ];

      const rows = assignments
        .map((a) => {
          const pid = typeof a.participant_id === "string" ? a.participant_id : "";
          const mid = typeof a.mentor_id === "string" ? a.mentor_id : "";
          const participant = participantById.get(pid);
          const mentor = mentorById.get(mid);
          return {
            ...a,
            participant_id: pid,
            assigned_at: a.assigned_at ?? "",
            status: a.unassigned_at ? "unassigned" : "active",
            participant_name: participant?.name ?? "",
            participant_email: participant?.email ?? "",
            participant_phone: participant?.phone_number ?? "",
            mentor_name: mentor?.name ?? "",
            mentor_email: mentor?.email ?? "",
          };
        })
        .sort((a, b) =>
          compareByParticipantThenDateDesc(
            {
              participantName: String(a.participant_name ?? ""),
              participantKey: String(a.participant_id ?? ""),
              dateStr: String(a.assigned_at ?? ""),
            },
            {
              participantName: String(b.participant_name ?? ""),
              participantKey: String(b.participant_id ?? ""),
              dateStr: String(b.assigned_at ?? ""),
            }
          )
        );

      csv = toCsv(columns, rows);
    } else if (categoryParam === "mentors") {
      const mentors = await fetchAllRows<MentorInfo>({
        admin,
        table: "mentors",
        select: "*",
        orderBy: { column: "created_at", ascending: true },
      });

      const columns = [
        "name",
        "email",
        "role",
        "is_active",
        "created_at",
        "updated_at",
        "user_id",
        "id",
      ];

      csv = toCsv(columns, mentors as unknown as Array<Record<string, unknown>>);
    } else if (categoryParam === "weekly_reports") {
      const [{ participantById }, allReports, shares] = await Promise.all([
        buildParticipantAndPseudonymMaps(admin),
        fetchAllRows<Record<string, unknown>>({
          admin,
          table: "weekly_reports",
          select:
            "id, participant_id, week_ending, week_range, badge_label, badge_icon, status, outreach_text, approved_at, queued_at, sent_at, sms_message_id, sms_sent_at, sms_last_error, last_error, email_job_id, created_at, updated_at",
          orderBy: { column: "week_ending", ascending: false },
        }),
        fetchAllRows<Record<string, unknown>>({
          admin,
          table: "weekly_report_shares",
          select: "weekly_report_id, token, is_active, access_count, last_accessed_at, expires_at",
        }).catch(() => [] as Array<Record<string, unknown>>),
      ]);

      if (participantIdFilter) {
        const pInfo = participantById.get(participantIdFilter);
        filename = `thrive-weekly_reports-${buildParticipantSlug(pInfo, participantIdFilter)}-${dateStamp}.csv`;
      }

      const reports = participantIdFilter
        ? allReports.filter((r) => r.participant_id === participantIdFilter)
        : allReports;

      const shareByReportId = new Map<string, Record<string, unknown>>();
      for (const s of shares) {
        if (typeof s.weekly_report_id === "string" && s.is_active) {
          shareByReportId.set(s.weekly_report_id, s);
        }
      }

      const columns = [
        "participant_name",
        "participant_email",
        "week_ending",
        "week_range",
        "badge_label",
        "badge_color",
        "badge_icon",
        "status",
        "outreach_text",
        "share_token",
        "share_access_count",
        "share_last_accessed_at",
        "share_expires_at",
        "approved_at",
        "queued_at",
        "sent_at",
        "sms_sent_at",
        "sms_message_id",
        "sms_last_error",
        "last_error",
        "email_job_id",
        "participant_id",
        "created_at",
        "updated_at",
        "id",
      ];

      const rows = reports
        .map((r) => {
          const pid = typeof r.participant_id === "string" ? r.participant_id : "";
          const rid = typeof r.id === "string" ? r.id : "";
          const participant = participantById.get(pid);
          const share = shareByReportId.get(rid);
          return {
            ...r,
            participant_id: pid,
            week_ending: r.week_ending ?? "",
            participant_name: participant?.name ?? "",
            participant_email: participant?.email ?? "",
            badge_color: badgeColorName(r.badge_icon, r.badge_label),
            share_token: share?.token ?? "",
            share_access_count: share?.access_count ?? "",
            share_last_accessed_at: share?.last_accessed_at ?? "",
            share_expires_at: share?.expires_at ?? "",
          };
        })
        .sort((a, b) =>
          compareByParticipantThenDateDesc(
            {
              participantName: String(a.participant_name ?? ""),
              participantKey: String(a.participant_id ?? ""),
              dateStr: String(a.week_ending ?? ""),
            },
            {
              participantName: String(b.participant_name ?? ""),
              participantKey: String(b.participant_id ?? ""),
              dateStr: String(b.week_ending ?? ""),
            }
          )
        );

      csv = toCsv(columns, rows);
    } else if (categoryParam === "monthly_reports") {
      const [{ participantById }, allReports, shares] = await Promise.all([
        buildParticipantAndPseudonymMaps(admin),
        fetchAllRows<Record<string, unknown>>({
          admin,
          table: "monthly_reports",
          select:
            "id, participant_id, month_ending, month_range, badge_label, badge_icon, status, outreach_text, approved_at, queued_at, sent_at, sms_message_id, sms_sent_at, sms_last_error, last_error, email_job_id, created_at, updated_at",
          orderBy: { column: "month_ending", ascending: false },
        }),
        fetchAllRows<Record<string, unknown>>({
          admin,
          table: "monthly_report_shares",
          select: "monthly_report_id, token, is_active, access_count, last_accessed_at, expires_at",
        }).catch(() => [] as Array<Record<string, unknown>>),
      ]);

      if (participantIdFilter) {
        const pInfo = participantById.get(participantIdFilter);
        filename = `thrive-monthly_reports-${buildParticipantSlug(pInfo, participantIdFilter)}-${dateStamp}.csv`;
      }

      const reports = participantIdFilter
        ? allReports.filter((r) => r.participant_id === participantIdFilter)
        : allReports;

      const shareByReportId = new Map<string, Record<string, unknown>>();
      for (const s of shares) {
        if (typeof s.monthly_report_id === "string" && s.is_active) {
          shareByReportId.set(s.monthly_report_id, s);
        }
      }

      const columns = [
        "participant_name",
        "participant_email",
        "month_ending",
        "month_range",
        "badge_label",
        "badge_color",
        "badge_icon",
        "status",
        "outreach_text",
        "share_token",
        "share_access_count",
        "share_last_accessed_at",
        "share_expires_at",
        "approved_at",
        "queued_at",
        "sent_at",
        "sms_sent_at",
        "sms_message_id",
        "sms_last_error",
        "last_error",
        "email_job_id",
        "participant_id",
        "created_at",
        "updated_at",
        "id",
      ];

      const rows = reports
        .map((r) => {
          const pid = typeof r.participant_id === "string" ? r.participant_id : "";
          const rid = typeof r.id === "string" ? r.id : "";
          const participant = participantById.get(pid);
          const share = shareByReportId.get(rid);
          return {
            ...r,
            participant_id: pid,
            month_ending: r.month_ending ?? "",
            participant_name: participant?.name ?? "",
            participant_email: participant?.email ?? "",
            badge_color: badgeColorName(r.badge_icon, r.badge_label),
            share_token: share?.token ?? "",
            share_access_count: share?.access_count ?? "",
            share_last_accessed_at: share?.last_accessed_at ?? "",
            share_expires_at: share?.expires_at ?? "",
          };
        })
        .sort((a, b) =>
          compareByParticipantThenDateDesc(
            {
              participantName: String(a.participant_name ?? ""),
              participantKey: String(a.participant_id ?? ""),
              dateStr: String(a.month_ending ?? ""),
            },
            {
              participantName: String(b.participant_name ?? ""),
              participantKey: String(b.participant_id ?? ""),
              dateStr: String(b.month_ending ?? ""),
            }
          )
        );

      csv = toCsv(columns, rows);
    } else if (categoryParam === "audit_logs") {
      const [{ participantById }, mentors, allLogs] = await Promise.all([
        buildParticipantAndPseudonymMaps(admin),
        fetchAllRows<MentorInfo>({ admin, table: "mentors", select: "*" }),
        fetchAllRows<Record<string, unknown>>({
          admin,
          table: "audit_logs",
          select: "*",
        }),
      ]);

      if (participantIdFilter) {
        const pInfo = participantById.get(participantIdFilter);
        filename = `thrive-audit_logs-${buildParticipantSlug(pInfo, participantIdFilter)}-${dateStamp}.csv`;
      }

      const mentorById = new Map(mentors.map((m) => [m.id, m]));
      const mentorByUserId = new Map(
        mentors.filter((m) => m.user_id).map((m) => [String(m.user_id), m])
      );

      const enrichedLogs = allLogs.map((l) => {
        const recordId = typeof l.record_id === "string" ? l.record_id : "";
        const directPid = typeof l.participant_id === "string" ? l.participant_id : "";
        const meta =
          l.metadata && typeof l.metadata === "object"
            ? (l.metadata as Record<string, unknown>)
            : null;
        const metaPid = typeof meta?.participant_id === "string" ? meta.participant_id : "";

        const resolvedParticipantId =
          (directPid && participantById.has(directPid) && directPid) ||
          (recordId && participantById.has(recordId) && recordId) ||
          (metaPid && participantById.has(metaPid) && metaPid) ||
          directPid ||
          (l.table_name === "participants" ? recordId : "");

        const participant = resolvedParticipantId
          ? participantById.get(resolvedParticipantId)
          : undefined;

        const userId = typeof l.user_id === "string" ? l.user_id : "";
        const mentor =
          (userId && (mentorByUserId.get(userId) || mentorById.get(userId))) || undefined;

        const timestampVal = String(
          l.timestamp ?? l.created_at ?? meta?.timestamp ?? ""
        );

        return {
          ...l,
          timestamp: timestampVal,
          participant_id: resolvedParticipantId,
          participant_name: participant?.name ?? "",
          participant_email: participant?.email ?? (typeof meta?.email === "string" ? meta.email : ""),
          actor_name: mentor?.name ?? participant?.name ?? "",
          actor_email: mentor?.email ?? participant?.email ?? "",
        };
      });

      const filteredLogs = participantIdFilter
        ? enrichedLogs.filter((l) => l.participant_id === participantIdFilter)
        : enrichedLogs;

      filteredLogs.sort((a, b) =>
        compareByParticipantThenDateDesc(
          {
            participantName: String(a.participant_name ?? ""),
            participantKey: String(a.participant_id ?? ""),
            dateStr: String(a.timestamp ?? ""),
          },
          {
            participantName: String(b.participant_name ?? ""),
            participantKey: String(b.participant_id ?? ""),
            dateStr: String(b.timestamp ?? ""),
          }
        )
      );

      const columns = [
        "participant_name",
        "participant_email",
        "timestamp",
        "action",
        "table_name",
        "record_id",
        "actor_name",
        "actor_email",
        "user_id",
        "metadata",
        "participant_id",
        "id",
      ];

      csv = toCsv(columns, filteredLogs);
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to export CSV";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

