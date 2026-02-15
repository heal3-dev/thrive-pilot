"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type StatusFilter = "all" | "active" | "removed" | "unverified";

type AssignedMentor = {
  mentor_id: string;
  mentor_name: string | null;
  mentor_email: string | null;
  assigned_at: string | null;
  unassigned_at: string | null;
};

type ParticipantRow = Participant & {
  assigned_mentor: AssignedMentor | null;
  is_unverified?: boolean;
  garmin_connected?: boolean;
};

type AssignmentHistoryRow = {
  id: string;
  mentor_id: string;
  participant_id: string;
  assigned_at: string | null;
  unassigned_at: string | null;
  mentor: { id: string; name: string | null; email: string | null } | null;
};

type CreateParticipantPayload = {
  email: string;
  name?: string;
  phone_number?: string;
  sendInvite?: boolean;
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

export function ParticipantManagement({ initialModal }: { initialModal?: "add" | "invite" }) {
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [mentorFilter, setMentorFilter] = useState<string>("all"); // mentor id | "all" | "unassigned"

  const [isInviteModalOpen, setIsInviteModalOpen] = useState(initialModal === "invite");
  const [isAddModalOpen, setIsAddModalOpen] = useState(initialModal === "add");
  const [editingParticipant, setEditingParticipant] = useState<ParticipantRow | null>(null);
  const [history, setHistory] = useState<AssignmentHistoryRow[]>([]);
  const [historyParticipant, setHistoryParticipant] = useState<ParticipantRow | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [backfillLoadingId, setBackfillLoadingId] = useState<string | null>(null);

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
    try {
      const json = await adminFetch("/api/admin/participants");
      setParticipants((json.participants as ParticipantRow[]) ?? []);
      setMentors((json.mentors as Mentor[]) ?? []);
      setError(null);
    } catch (err) {
      console.error("Error fetching participants:", err);
      setError(err instanceof Error ? err.message : "Failed to load participants");
    } finally {
      setIsLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    fetchParticipants();
  }, [fetchParticipants]);

  useEffect(() => {
    const channel = supabase
      .channel("participants-management")
      .on("postgres_changes", { event: "*", schema: "public", table: "participants" }, () => fetchParticipants())
      .on("postgres_changes", { event: "*", schema: "public", table: "mentor_assignments" }, () => fetchParticipants())
      .on("postgres_changes", { event: "*", schema: "public", table: "mentors" }, () => fetchParticipants())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchParticipants]);

  const filteredParticipants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return participants.filter((p) => {
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
        (statusFilter === "unverified" && isUnverified);

      const assignedMentor = p.assigned_mentor;
      // Consider "assigned" only if it's an active assignment (unassigned_at is null)
      const isActiveAssignment = assignedMentor && !assignedMentor.unassigned_at;
      
      const matchesMentor =
        mentorFilter === "all" ||
        (mentorFilter === "unassigned" && !isActiveAssignment) ||
        (mentorFilter !== "unassigned" && mentorFilter !== "all" && isActiveAssignment && assignedMentor?.mentor_id === mentorFilter);

      return matchesSearch && matchesStatus && matchesMentor;
    });
  }, [participants, searchQuery, statusFilter, mentorFilter]);



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
      await adminFetch(`/api/admin/participants/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: nextIsActive }),
      });
      setSuccessMessage(nextIsActive ? "Participant activated" : "Participant deactivated");
      setTimeout(() => setSuccessMessage(null), 3000);
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

  const handleConnectGarmin = async (p: ParticipantRow) => {
    if (!p.email) {
      setError("Participant is missing an email address");
      return;
    }

    try {
      setError(null);
      const result = await adminFetch("/api/garmin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participant_id: p.id,
          email: p.email,
        }),
      });
      setSuccessMessage(result?.message ?? `Garmin invite sent to ${p.email}`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error("Error sending Garmin invite:", err);
      setError(err instanceof Error ? err.message : "Failed to send Garmin invite");
    }
  };

  const handleBackfill = async (p: ParticipantRow) => {
    if (!confirm(`Sync last 30 days of Garmin data for ${p.name || p.email || "this participant"}?`)) return;

    setBackfillLoadingId(p.id);
    setError(null);

    try {
      const today = new Date();
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);

      const endDate = today.toISOString().split("T")[0];
      const startDate = thirtyDaysAgo.toISOString().split("T")[0];

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

  if (error) {
    return (
      <div className="bg-white rounded-2xl border-2 border-red-100 p-8 text-center">
        <p className="text-red-600 font-semibold">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {successMessage && (
        <div className="p-4 rounded-xl bg-green-50 border border-green-200">
          <p className="text-sm font-medium text-green-700 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {successMessage}
          </p>
        </div>
      )}

      <div className="bg-white rounded-2xl border-2 border-slate-100 p-4">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
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
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="removed">Inactive</option>
              <option value="unverified">Unverified</option>
            </select>

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
          </div>

          <div className="flex gap-2">
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
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border-2 border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-[10%]" />
              <col className="w-[12%]" />
              <col className="w-[20%]" />
              <col className="w-[15%]" />
              <col className="w-[8%]" />
              <col className="w-[15%]" />
              <col className="w-[20%]" />
            </colgroup>
            <thead className="bg-slate-100 border-b border-slate-100">
              <tr>
                <th className="text-left px-3 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Name</th>
                <th className="text-left px-3 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Phone</th>
                <th className="text-left px-3 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Email</th>
                <th className="text-left px-3 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Mentor</th>
                <th className="text-left px-3 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Status</th>
                <th className="text-center px-3 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Garmin</th>
                <th className="text-right px-3 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredParticipants.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    {searchQuery || statusFilter !== "all" || mentorFilter !== "all"
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
                      <p className="font-semibold text-slate-900 truncate">{p.name || "—"}</p>
                      <p className="text-xs text-slate-500">
                        {p.is_unverified ? "Invited" : "Created"} {formatDate(p.created_at ?? null)}
                      </p>
                    </td>
                    <td className="px-3 py-4 text-slate-700 text-sm truncate">{formatPhone(p.phone_number)}</td>
                    <td className="px-3 py-4 text-slate-700 text-sm truncate">{p.email || "—"}</td>
                    <td className="px-3 py-4">
                      {p.assigned_mentor && !p.assigned_mentor.unassigned_at ? (
                        <div>
                          <p className="font-semibold text-slate-900 truncate">{p.assigned_mentor.mentor_name || "—"}</p>
                          <p className="text-xs text-slate-500 truncate">{p.assigned_mentor.mentor_email || ""}</p>
                        </div>
                      ) : (
                        <span className="text-slate-500">Unassigned</span>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      {p.is_unverified ? (
                        <span className="inline-flex px-2 py-0.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-700">
                          Unverified
                        </span>
                      ) : p.is_active === false ? (
                        <span className="inline-flex px-2 py-0.5 rounded-lg text-xs font-semibold bg-slate-200 text-slate-700">
                          Inactive
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-lg text-xs font-semibold bg-green-100 text-green-700">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-4 text-center">
                      {!p.is_unverified && (
                        isConnected ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => { e.stopPropagation(); handleBackfill(p); }}
                                disabled={backfillLoadingId === p.id}
                                className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 font-medium w-full justify-center"
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
                                  "Sync History"
                                )}
                              </Button>
                        ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => { e.stopPropagation(); handleConnectGarmin(p); }}
                                className="text-teal-600 hover:text-teal-700 hover:bg-teal-50 font-medium w-full justify-center"
                              >
                                Connect Garmin
                              </Button>
                        )
                      )}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        {p.is_unverified ? (
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

    if (!isValidPhone(phone)) {
      setLocalError("Invalid phone number. Use E.164 (+15551234567) or a basic 10-digit format.");
      return;
    }

    await onSubmit({
      name: name.trim() ? name.trim() : null,
      email: email.trim() ? email.trim() : null,
      phone_number: phone.trim() ? phone.trim() : null,
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



