"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { AddParticipantModal } from "./modals/AddParticipantModal";
import { InviteParticipantModal } from "./modals/InviteParticipantModal";
import { toE164 } from "@/lib/utils";
import type { Mentor, Participant } from "@/types";

// Debounced uniqueness check hook removed (using import from hooks)
// toE164 removed (using import from utils)

type StatusFilter = "all" | "active" | "removed" | "invited";
type FlagsFilter = "all" | "sync_stale" | "weekly_green" | "weekly_yellow" | "weekly_orange" | "weekly_red";

type AssignedMentor = {
  mentor_id: string;
  mentor_name: string | null;
  mentor_email: string | null;
  assigned_at: string | null;
  unassigned_at: string | null;
};

import type { WeeklyFlag } from "@/lib/flags/rules";
import { DEMO_PARTICIPANTS } from "@/lib/demo-data";
import { weeklyCompositeTooltip } from "@/lib/flags/weekly-tooltips";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

type ParticipantRow = Participant & {
  assigned_mentor: AssignedMentor | null;
  is_unverified?: boolean;
  invite_status?: "pending" | "expired";
  invite_sent_at?: string | null;
  invite_expires_at?: string | null;
  garmin_connected?: boolean;
  garmin_sync_stale?: boolean;
  weekly_flag?: WeeklyFlag | null;
};

type UpdateParticipantPayload = {
  name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  is_active?: boolean;
};

function formatPhone(phone: string | null | undefined) {
  if (!phone) return "—";
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  // Ensure UTC interpretation if timezone is missing
  let s = dateStr;
  if (s.includes("T") && !s.endsWith("Z") && !s.includes("+")) {
    s += "Z";
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric" });
}



// Validate that phone can be converted to E.164
function isValidPhone(phone: string): boolean {
  return toE164(phone) !== null;
}

export function ParticipantManagement({ 
  initialModal,
  mode = "management",
  initialGarminFilter = "all",
  demoMode = false,
}: { 
  initialModal?: "add" | "invite";
  mode?: "management" | "trends" | "mentor-trends";
  initialGarminFilter?: "all" | "connected" | "disconnected";
  demoMode?: boolean;
}) {
  const router = useRouter();
  // ParticipantManagement is always embedded inside a fixed-height panel (Admin/Mentor tabs).
  // Keep page chrome fixed; only scroll table rows.
  const rowsScrollOnly = true;
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(mode === "management" ? "active" : "all");
  const [mentorFilter, setMentorFilter] = useState<string>("all"); // mentor id | "all" | "unassigned"
  const [garminFilter, setGarminFilter] = useState<"all" | "connected" | "disconnected">(initialGarminFilter);
  const [flagsFilter, setFlagsFilter] = useState<FlagsFilter>("all");

  const [isInviteModalOpen, setIsInviteModalOpen] = useState(initialModal === "invite");
  const [isAddModalOpen, setIsAddModalOpen] = useState(initialModal === "add");
  const [editingParticipant, setEditingParticipant] = useState<ParticipantRow | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [backfillLoadingId, setBackfillLoadingId] = useState<string | null>(null);
  const [garminInviteLoadingId, setGarminInviteLoadingId] = useState<string | null>(null);
  const [inviteAlertDismissed, setInviteAlertDismissed] = useState(false);
  const [inviteAlertDismissedTotal, setInviteAlertDismissedTotal] = useState<number | null>(
    null
  );

  const getAccessToken = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData?.session?.access_token ?? null;
  }, []);

  const adminFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessToken();
      if (!token) throw new Error("Authentication required");

      const res = await fetch(path, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || "Request failed");
      return json;
    },
    [getAccessToken]
  );

  const fetchParticipants = useCallback(async () => {
    if (demoMode) {
      const demoRows: ParticipantRow[] = DEMO_PARTICIPANTS.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        phone_number: p.phone_number,
        garmin_user_id: p.garmin_user_id,
        is_active: true,
        garmin_connected: true,
        assigned_mentor: null,
        weekly_flag: p.weekly_flag,
        created_at: p.garmin_connected_at,
      }));
      setParticipants(demoRows);
      setMentors([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    try {
      const endpoint = mode === "mentor-trends" ? "/api/mentor/participants" : "/api/admin/participants";
      const json = await adminFetch(endpoint);
      setParticipants((json.participants as ParticipantRow[]) ?? []);
      setMentors((json.mentors as Mentor[]) ?? []);
      setError(null);
    } catch (err) {
      console.error("Error fetching participants:", err);
      setError(err instanceof Error ? err.message : "Failed to load participants");
    } finally {
      setIsLoading(false);
    }
  }, [adminFetch, mode, demoMode]);

  useEffect(() => {
    fetchParticipants();
  }, [fetchParticipants]);

  const inviteOnlyCounts = useMemo(() => {
    const inviteOnly = participants.filter((p) => p.is_unverified);
    const pending = inviteOnly.filter((p) => p.invite_status !== "expired").length;
    const expired = inviteOnly.filter((p) => p.invite_status === "expired").length;
    return {
      total: inviteOnly.length,
      pending,
      expired,
    };
  }, [participants]);

  // If new invite-only users appear after dismissal, re-show the banner.
  useEffect(() => {
    if (!inviteAlertDismissed) return;
    if (inviteAlertDismissedTotal === null) return;
    if (inviteOnlyCounts.total > inviteAlertDismissedTotal) {
      setInviteAlertDismissed(false);
      setInviteAlertDismissedTotal(null);
    }
  }, [inviteOnlyCounts.total, inviteAlertDismissed, inviteAlertDismissedTotal]);

  useEffect(() => {
    if (demoMode) return;

    let channel = supabase
      .channel(mode === "mentor-trends" ? "mentor-participants-management" : "participants-management")
      .on("postgres_changes", { event: "*", schema: "public", table: "participants" }, () => fetchParticipants())
      .on("postgres_changes", { event: "*", schema: "public", table: "mentor_assignments" }, () => fetchParticipants());

    if (mode !== "mentor-trends") {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "mentors" }, () => fetchParticipants());
    }

    const subscription = channel.subscribe();

    return () => {
      void supabase.removeChannel(subscription);
    };
  }, [fetchParticipants, mode, demoMode]);

  const filteredParticipants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = participants.filter((p) => {
      const matchesSearch =
        q.length === 0 ||
        (p.name ?? "").toLowerCase().includes(q) ||
        (p.email ?? "").toLowerCase().includes(q) ||
        (p.phone_number ?? "").toLowerCase().includes(q);

      const isUnverified = !!(p as ParticipantRow).is_unverified;
      const isRemoved = !isUnverified && p.is_active === false;
      const isActive = !isUnverified && p.is_active !== false;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && isActive) ||
        (statusFilter === "removed" && isRemoved) ||
        (statusFilter === "invited" && isUnverified);

      const assignedMentor = p.assigned_mentor;
      // Consider "assigned" only if it's an active assignment (unassigned_at is null)
      const isActiveAssignment = assignedMentor && !assignedMentor.unassigned_at;
      
      const matchesMentor =
        mentorFilter === "all" ||
        (mentorFilter === "unassigned" && !isActiveAssignment) ||
        (mentorFilter !== "unassigned" && mentorFilter !== "all" && isActiveAssignment && assignedMentor?.mentor_id === mentorFilter);

      const isConnected = p.garmin_connected === true || Boolean(p.garmin_user_id);
      const matchesGarmin =
        garminFilter === "all" ||
        (garminFilter === "connected" && isConnected) ||
        (garminFilter === "disconnected" && !isConnected);

      const weeklyColor = p.weekly_flag?.finalColor ?? null;
      const matchesFlags =
        flagsFilter === "all" ||
        (flagsFilter === "sync_stale" && p.garmin_sync_stale === true) ||
        (flagsFilter === "weekly_green" && weeklyColor === "green") ||
        (flagsFilter === "weekly_yellow" && weeklyColor === "yellow") ||
        (flagsFilter === "weekly_orange" && weeklyColor === "orange") ||
        (flagsFilter === "weekly_red" && weeklyColor === "red");

      return matchesSearch && matchesStatus && matchesMentor && matchesGarmin && matchesFlags;
    });

    function invitedRank(p: ParticipantRow): number {
      if (!p.is_unverified) return 99;
      // Pending invites first, then expired, then unknown.
      if (p.invite_status === "pending") return 0;
      if (p.invite_status === "expired") return 1;
      return 2;
    }

    const sorted = [...filtered].sort((a, b) => {
      const aInv = invitedRank(a);
      const bInv = invitedRank(b);

      // When viewing all statuses, always show invite-only rows first.
      // When viewing invited-only rows, keep pending above expired.
      if (statusFilter === "all" || statusFilter === "invited") {
        if (aInv !== bInv) return aInv - bInv;
      }

      // Keep existing relative ordering for non-invite rows when "all" is selected.
      if (statusFilter === "all") return 0;

      // Fallback deterministic ordering (most recent first) for invited-only view.
      if (statusFilter === "invited") {
        const aTs = new Date(a.invite_sent_at ?? a.created_at ?? 0).getTime();
        const bTs = new Date(b.invite_sent_at ?? b.created_at ?? 0).getTime();
        return bTs - aTs;
      }

      return 0;
    });

    return sorted;
  }, [participants, searchQuery, statusFilter, mentorFilter, garminFilter, flagsFilter]);



  const handleUpdateParticipant = async (participantId: string, payload: UpdateParticipantPayload) => {
    setIsSaving(true);
    setFormError(null);
    try {
      await adminFetch(`/api/admin/participants/${participantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setEditingParticipant(null);
      setSuccessMessage("Participant updated successfully");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error("Error updating participant:", err);
      setFormError(err instanceof Error ? err.message : "Failed to update participant");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (p: ParticipantRow) => {
    const nextIsActive = p.is_active === false;
    const confirmText = nextIsActive
      ? "Activate this participant?"
      : "Deactivate this participant? This will also end their current mentor assignment.";
    if (!confirm(confirmText)) return;

    try {
      setError(null);
      await adminFetch(`/api/admin/participants/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: nextIsActive }),
      });
      setSuccessMessage(nextIsActive ? "Participant activated" : "Participant deactivated");
      setTimeout(() => setSuccessMessage(null), 3000);
      fetchParticipants();
    } catch (err) {
      console.error("Error toggling participant:", err);
      setError(err instanceof Error ? err.message : "Failed to update participant");
    }
  };

  const handleResendInvite = async (p: ParticipantRow) => {
    if (!confirm(`Resend invite email to ${p.email}?`)) return;

    try {
      await adminFetch(`/api/admin/participants/${p.id}/resend-invite`, {
        method: "POST",
      });
      setSuccessMessage(`Invite resent to ${p.email}`);
      setTimeout(() => setSuccessMessage(null), 3000);
      fetchParticipants();
    } catch (err) {
      console.error("Error resending invite:", err);
      setError(err instanceof Error ? err.message : "Failed to resend invite");
    }
  };

  const handleConnectGarmin = async (p: ParticipantRow, opts?: { force?: boolean }) => {
    if (!p.email) {
      setError("Participant is missing an email address");
      return;
    }

    try {
      setError(null);
      setGarminInviteLoadingId(p.id);
      const result = await adminFetch("/api/garmin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participant_id: p.id,
          email: p.email,
          force: Boolean(opts?.force),
        }),
      });
      setSuccessMessage(result?.message ?? `Garmin invite sent to ${p.email}`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error("Error sending Garmin invite:", err);
      setError(err instanceof Error ? err.message : "Failed to send Garmin invite");
    } finally {
      setGarminInviteLoadingId(null);
    }
  };

  const handleBackfill = async (p: ParticipantRow) => {
    if (!confirm(`Sync last 7 days of Garmin data for ${p.name || p.email || "this participant"}?`)) return;

    setBackfillLoadingId(p.id);
    setError(null);

    try {
      const today = new Date();
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(today.getDate() - 7);

      const endDate = today.toISOString().split("T")[0];
      const startDate = sevenDaysAgo.toISOString().split("T")[0];

      const result = await adminFetch("/api/garmin/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participant_id: p.id,
          start_date: startDate,
          end_date: endDate,
        }),
      });

      setSuccessMessage(result?.message ?? "Garmin data sync complete");
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      console.error("Error running Garmin backfill:", err);
      setError(err instanceof Error ? err.message : "Failed to sync Garmin data");
    } finally {
      setBackfillLoadingId(null);
    }
  };

  const handleDeleteUnverified = async (p: ParticipantRow) => {
    if (!confirm(`Delete invited user ${p.email}? This cannot be undone.`)) return;

    try {
      await adminFetch(`/api/admin/participants/${p.id}`, {
        method: "DELETE",
      });
      setSuccessMessage(`Invited user ${p.email} deleted`);
      setTimeout(() => setSuccessMessage(null), 3000);
      fetchParticipants();
    } catch (err) {
      console.error("Error deleting unverified user:", err);
      setError(err instanceof Error ? err.message : "Failed to delete user");
    }
  };



  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border-2 border-slate-100 p-8 flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3 text-slate-500">
          <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="font-medium">Loading participants...</span>
        </div>
      </div>
    );
  }

  // Removed blocking error return. Error is displayed in the banner below.

  return (
    <div className={rowsScrollOnly ? "h-full min-h-0 flex flex-col gap-4" : "space-y-4"}>
      {successMessage && (
        <div className="p-4 rounded-xl bg-green-50 border border-green-200 shrink-0">
          <p className="text-sm font-medium text-green-700 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {successMessage}
          </p>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 shrink-0">
          <p className="text-sm font-medium text-red-700 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {error}
          </p>
        </div>
      )}

      {mode === "management" &&
        !demoMode &&
        inviteOnlyCounts.total > 0 &&
        !inviteAlertDismissed && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <svg
                  className="w-5 h-5 text-amber-700 mt-0.5 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    {inviteOnlyCounts.total}{" "}
                    {inviteOnlyCounts.total === 1 ? "unverified invite" : "unverified invites"}{" "}
                    need attention
                  </p>
                  <p className="text-sm text-amber-800">
                    {inviteOnlyCounts.pending} pending, {inviteOnlyCounts.expired} expired. Open the
                    Unverified filter to resend invites or clean up old accounts.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => setStatusFilter("invited")}
                      className="bg-amber-600 hover:bg-amber-700 text-white"
                    >
                      View Unverified
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setInviteAlertDismissed(true);
                        setInviteAlertDismissedTotal(inviteOnlyCounts.total);
                      }}
                      className="border-amber-300 text-amber-900 hover:bg-amber-100"
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>

              <button
                type="button"
                aria-label="Dismiss invite alert"
                onClick={() => {
                  setInviteAlertDismissed(true);
                  setInviteAlertDismissedTotal(inviteOnlyCounts.total);
                }}
                className="p-1 rounded-md text-amber-700 hover:text-amber-900 hover:bg-amber-100"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

      <div className="bg-white rounded-2xl border-2 border-slate-100 p-4 shrink-0">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-center min-w-0">
            <Input
              placeholder="Search by name, phone, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-72 h-10 rounded-lg shadow-none text-sm placeholder:text-sm"
            />

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 shadow-none"
              disabled={mode === "mentor-trends"}
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="removed">Inactive</option>
              <option value="invited">Unverified</option>
            </select>

            {mode !== "mentor-trends" && (
              <select
                value={mentorFilter}
                onChange={(e) => setMentorFilter(e.target.value)}
                className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 shadow-none"
              >
                <option value="all">All Mentors</option>
                <option value="unassigned">Unassigned</option>
                {mentors
                  .filter((m) => m.is_active !== false && m.role !== "admin")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.email || "Unnamed mentor"}
                    </option>
                  ))}
              </select>
            )}

            <select
              value={garminFilter}
              onChange={(e) => setGarminFilter(e.target.value as "all" | "connected" | "disconnected")}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 shadow-none"
            >
              <option value="all">All Garmin</option>
              <option value="connected">Connected</option>
              <option value="disconnected">Disconnected</option>
            </select>

            <select
              value={flagsFilter}
              onChange={(e) => setFlagsFilter(e.target.value as FlagsFilter)}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 shadow-none"
              disabled={mode === "mentor-trends"}
            >
              <option value="all">All Flags</option>
              <option value="sync_stale">Sync Stale</option>
              <option value="weekly_green">Weekly: Green</option>
              <option value="weekly_yellow">Weekly: Yellow</option>
              <option value="weekly_orange">Weekly: Orange</option>
              <option value="weekly_red">Weekly: Red</option>
            </select>
          </div>

          <div className="flex gap-2">
            {mode === "management" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsAddModalOpen(true)}
                  className="border-slate-300 text-slate-700 hover:bg-slate-100"
                >
                  <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add Participant
                </Button>
                <Button
                  size="sm"
                  onClick={() => setIsInviteModalOpen(true)}
                  className="bg-teal-500 hover:bg-teal-600 text-white"
                >
                  <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Invite Participant
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className={`bg-white rounded-2xl border-2 border-slate-100 overflow-hidden ${rowsScrollOnly ? "flex-1 min-h-0" : ""}`}>
        <div className={rowsScrollOnly ? "h-full overflow-auto" : "overflow-x-auto"}>
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-[14%]" />
              <col className="w-[15%]" />
              <col className="w-[18%]" />
              <col className="w-[17%]" />
              <col className="w-[12%]" />
              <col className="w-[9%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead className={`bg-slate-100 border-b border-slate-100 ${rowsScrollOnly ? "sticky top-0 z-10" : ""}`}>
              <tr>
                <th className="text-left px-3 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Name</th>
                <th className="text-left px-3 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Phone</th>
                <th className="text-left px-3 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Email</th>
                <th className="text-left px-3 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Mentor</th>
                <th className="text-left px-3 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Status & Flags</th>
                <th className="text-center px-2 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Garmin</th>
                <th className="text-right px-2 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredParticipants.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    {searchQuery || statusFilter !== "all" || mentorFilter !== "all" || garminFilter !== "all"
                      ? "No participants match your filters"
                      : "No participants found"}
                  </td>
                </tr>
              ) : (
                filteredParticipants.map((p) => {
                   const isConnected = p.garmin_connected === true || Boolean(p.garmin_user_id);
                   return (
                  <tr
                    key={p.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-3 py-4">
                      <p className="font-semibold text-slate-900 whitespace-normal leading-snug break-words" title={p.name ?? ""}>{p.name || "—"}</p>
                      <p className="text-xs text-slate-500">
                        {p.is_unverified ? "Invited" : "Created"} {formatDate(p.created_at ?? null)}
                      </p>
                    </td>
                    <td className="px-3 py-4 text-slate-700 text-sm truncate" title={formatPhone(p.phone_number) ?? ""}>{formatPhone(p.phone_number)}</td>
                    <td className="px-2 py-4 text-slate-700 text-sm whitespace-normal break-words leading-snug" title={p.email ?? ""}>{p.email || "—"}</td>
                    <td className="px-3 py-4">
                      {p.assigned_mentor && !p.assigned_mentor.unassigned_at ? (
                        <div>
                          <p className="font-semibold text-slate-900 whitespace-normal break-words leading-snug" title={p.assigned_mentor.mentor_name ?? ""}>{p.assigned_mentor.mentor_name || "—"}</p>
                          <p className="text-xs text-slate-500 whitespace-normal break-words leading-snug" title={p.assigned_mentor.mentor_email ?? ""}>{p.assigned_mentor.mentor_email || ""}</p>
                        </div>
                      ) : (
                        <span className="text-slate-500">Unassigned</span>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex flex-col gap-1 items-start">
                        {p.is_unverified ? (
                          p.invite_status === "expired" ? (
                            <span className="inline-flex px-2 py-0.5 rounded-lg text-xs font-semibold bg-slate-200 text-slate-700">
                              Invite Expired
                            </span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-700">
                              Invite Pending
                            </span>
                          )
                        ) : p.is_active === false ? (
                          <span className="inline-flex px-2 py-0.5 rounded-lg text-xs font-semibold bg-slate-200 text-slate-700">
                            Inactive
                          </span>
                        ) : p.garmin_sync_stale ? (
                          <span className="inline-flex w-fit whitespace-nowrap px-2 py-0.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                            Active (Sync Stale)
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-lg text-xs font-semibold bg-green-100 text-green-700">
                            Active
                          </span>
                        )}
                        
                        {p.weekly_flag && (
                          <TooltipProvider delayDuration={0} skipDelayDuration={0}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-bold border whitespace-nowrap cursor-help ${
                                    p.weekly_flag.finalColor === "red"
                                      ? "bg-red-50 text-red-700 border-red-200"
                                      : p.weekly_flag.finalColor === "orange"
                                      ? "bg-orange-50 text-orange-700 border-orange-200"
                                      : p.weekly_flag.finalColor === "yellow"
                                      ? "bg-amber-50 text-amber-700 border-amber-200"
                                      : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  }`}
                                >
                                  Weekly{" "}
                                  {p.weekly_flag.finalColor === "green"
                                    ? "🟢"
                                    : p.weekly_flag.finalColor === "yellow"
                                    ? "🟡"
                                    : p.weekly_flag.finalColor === "orange"
                                    ? "🟠"
                                    : "🔴"}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" align="start">
                                {weeklyCompositeTooltip(p.weekly_flag)}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-4 text-center">
                      {!p.is_unverified && mode === "mentor-trends" && (
                        <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-semibold ${
                          isConnected ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-600"
                        }`}>
                          {isConnected ? "Connected" : "Not Connected"}
                        </span>
                      )}
                      {!p.is_unverified && mode !== "mentor-trends" && (
                        isConnected ? (
                          <div className="w-full flex flex-col items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handleBackfill(p); }}
                              disabled={backfillLoadingId === p.id}
                              className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 w-full justify-center px-2 text-sm whitespace-normal leading-tight py-2"
                            >
                              {backfillLoadingId === p.id ? (
                                <span className="flex items-center gap-1">
                                  <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                  </svg>
                                  Syncing
                                </span>
                              ) : (
                                "Sync last 7 days"
                              )}
                            </Button>

                            {p.garmin_sync_stale ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleConnectGarmin(p, { force: true });
                                }}
                                disabled={garminInviteLoadingId === p.id}
                                className="text-teal-700 hover:text-teal-800 hover:bg-teal-50 w-full justify-center px-2 text-sm whitespace-normal leading-tight py-2"
                              >
                                {garminInviteLoadingId === p.id ? (
                                  <span className="flex items-center gap-1">
                                    <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path
                                        className="opacity-75"
                                        fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                      />
                                    </svg>
                                    Sending…
                                  </span>
                                ) : (
                                  "Refresh Garmin"
                                )}
                              </Button>
                            ) : null}
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); handleConnectGarmin(p); }}
                            className="text-teal-600 hover:text-teal-700 hover:bg-teal-50 w-full justify-center px-2"
                          >
                            Connect Garmin
                          </Button>
                        )
                      )}
                    </td>
                    <td className="px-2 py-4">
                      <div
                        className={
                          mode === "trends" || mode === "mentor-trends"
                            ? "flex items-center justify-end gap-1"
                            : "flex flex-col items-end gap-0.5"
                        }
                        onClick={(e) => e.stopPropagation()}
                      >
                        {mode === "trends" || mode === "mentor-trends" ? (
                          <Button
                             variant="outline"
                             size="sm"
                             onClick={() => router.push(`/dashboard/participants/${p.id}`)}
                             className="bg-white hover:bg-slate-50 text-slate-700 border-slate-200"
                          >
                            View Trend
                          </Button>
                        ) : p.is_unverified ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleResendInvite(p)}
                              className="text-teal-600 hover:text-teal-700"
                            >
                              Resend Invite
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteUnverified(p)}
                              className="text-red-600 hover:text-red-700"
                            >
                              Delete
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setFormError(null);
                                setEditingParticipant(p);
                              }}
                              className="text-slate-600 hover:text-slate-900"
                            >
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleActive(p)}
                              className={p.is_active === false ? "text-green-600 hover:text-green-700" : "text-red-600 hover:text-red-700"}
                            >
                              {p.is_active === false ? "Activate" : "Deactivate"}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )})
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isInviteModalOpen && (
        <InviteParticipantModal
          isOpen={true}
          onClose={() => setIsInviteModalOpen(false)}
          onSuccess={() => {
            fetchParticipants();
            setSuccessMessage("Invite sent successfully");
            setTimeout(() => setSuccessMessage(null), 3000);
          }}
        />
      )}

      {isAddModalOpen && (
        <AddParticipantModal
          isOpen={true}
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={() => {
            fetchParticipants();
            setSuccessMessage("Participant added successfully");
            setTimeout(() => setSuccessMessage(null), 3000);
          }}
        />
      )}

      {editingParticipant && (
        <EditParticipantModal
          participant={editingParticipant}
          onClose={() => {
            setEditingParticipant(null);
            setFormError(null);
          }}
          onSubmit={(payload) => handleUpdateParticipant(editingParticipant.id, payload)}
          isSaving={isSaving}
          error={formError}
        />
      )}



    </div>
  );
}

// Internal modals removed




function EditParticipantModal({
  participant,
  onClose,
  onSubmit,
  isSaving,
  error,
}: {
  participant: ParticipantRow;
  onClose: () => void;
  onSubmit: (payload: UpdateParticipantPayload) => Promise<void>;
  isSaving: boolean;
  error: string | null;
}) {
  const [name, setName] = useState(participant.name ?? "");
  const [email, setEmail] = useState(participant.email ?? "");
  const [phone, setPhone] = useState(participant.phone_number ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const e164Phone = phone.trim() ? toE164(phone) : null;
    if (phone.trim() && !e164Phone) {
      setLocalError("Invalid phone number. Use E.164 (+15551234567) or a basic 10-digit format.");
      return;
    }

    await onSubmit({
      name: name.trim() ? name.trim() : null,
      email: email.trim() ? email.trim() : null,
      // Store in E.164 so Twilio can reliably deliver messages.
      phone_number: e164Phone,
    });
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Edit Participant"
      subtitle={`ID: ${participant.id}`}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {(error || localError) && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200">
            <p className="text-sm text-red-600">{localError ?? error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="—" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-phone">Phone</Label>
            <Input id="edit-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+15551234567" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="edit-email">Email</Label>
          <Input
            id="edit-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="participant@example.com"
          />
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
          <p className="text-sm text-slate-500 mb-1">Current assignment</p>
          {participant.assigned_mentor ? (
            <div>
              {participant.assigned_mentor.unassigned_at ? (
                <>
                  <p className="font-semibold text-slate-900">Unassigned</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Last assigned to <strong>{participant.assigned_mentor.mentor_name}</strong> {participant.assigned_mentor.mentor_email ? `(${participant.assigned_mentor.mentor_email})` : ""} on {formatDate(participant.assigned_mentor.assigned_at)}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-slate-900">
                    {participant.assigned_mentor.mentor_name || "—"}{" "}
                    <span className="font-normal text-slate-500">
                      {participant.assigned_mentor.mentor_email ? `(${participant.assigned_mentor.mentor_email})` : ""}
                    </span>
                  </p>
                  {participant.assigned_mentor.assigned_at && (
                    <p className="text-xs text-slate-500 mt-1">
                      Assigned on {formatDate(participant.assigned_mentor.assigned_at)}
                    </p>
                  )}
                </>
              )}
            </div>
          ) : (
            <p className="font-semibold text-slate-900">Unassigned</p>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving} className="flex-1 bg-teal-500 hover:bg-teal-600 text-white">
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}



