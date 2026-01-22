"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Mentor, Participant } from "@/types";

type StatusFilter = "all" | "active" | "removed";

type AssignedMentor = {
  mentor_id: string;
  mentor_name: string | null;
  mentor_email: string | null;
};

type ParticipantRow = Participant & {
  assigned_mentor: AssignedMentor | null;
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
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Convert phone to E.164 format, returns null if invalid
// Supports: (555) 123-4567, 555-123-4567, 5551234567, +15551234567, 1-555-123-4567
function toE164(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;
  
  // Already in E.164 format
  if (/^\+[1-9]\d{9,14}$/.test(trimmed)) {
    return trimmed;
  }
  
  // Extract only digits
  const digits = trimmed.replace(/\D/g, "");
  
  // 10 digits (e.g., 5551234567) → assume US/Canada (+1)
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  
  // 11 digits starting with 1 (e.g., 15551234567) → US/Canada
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  
  // 11-15 digits not starting with 1 → add + prefix
  if (digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }
  
  return null; // Invalid
}

// Validate that phone can be converted to E.164
function isValidPhone(phone: string): boolean {
  return toE164(phone) !== null;
}

export function ParticipantManagement() {
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [mentorFilter, setMentorFilter] = useState<string>("all"); // mentor id | "all" | "unassigned"

  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingParticipant, setEditingParticipant] = useState<ParticipantRow | null>(null);
  const [historyParticipant, setHistoryParticipant] = useState<ParticipantRow | null>(null);

  const [history, setHistory] = useState<AssignmentHistoryRow[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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

      const isRemoved = p.is_active === false;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && !isRemoved) ||
        (statusFilter === "removed" && isRemoved);

      const assignedMentorId = p.assigned_mentor?.mentor_id ?? null;
      const matchesMentor =
        mentorFilter === "all" ||
        (mentorFilter === "unassigned" && !assignedMentorId) ||
        (mentorFilter !== "unassigned" && mentorFilter !== "all" && assignedMentorId === mentorFilter);

      return matchesSearch && matchesStatus && matchesMentor;
    });
  }, [participants, searchQuery, statusFilter, mentorFilter]);

  const handleCreateParticipant = async (payload: CreateParticipantPayload) => {
    setIsSaving(true);
    setFormError(null);
    try {
      const json = await adminFetch("/api/admin/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setIsInviteModalOpen(false);
      setIsAddModalOpen(false);
      const inviteSent = Boolean(json.inviteSent);
      const inviteError = json.inviteError as string | undefined;
      setSuccessMessage(
        inviteSent
          ? `Invite sent to ${payload.email}`
          : inviteError
            ? `Participant created, invite not sent: ${inviteError}`
            : "Participant added successfully"
      );
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error("Error creating participant:", err);
      setFormError(err instanceof Error ? err.message : "Failed to create participant");
    } finally {
      setIsSaving(false);
    }
  };

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
      ? "Restore this participant?"
      : "Remove this participant? This is a soft delete (SMS history is preserved).";
    if (!confirm(confirmText)) return;

    try {
      await adminFetch(`/api/admin/participants/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: nextIsActive }),
      });
      setSuccessMessage(nextIsActive ? "Participant restored" : "Participant removed");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error("Error toggling participant:", err);
      setError(err instanceof Error ? err.message : "Failed to update participant");
    }
  };

  const openHistory = async (p: ParticipantRow) => {
    setHistoryParticipant(p);
    setIsLoadingHistory(true);
    setHistory([]);
    try {
      const json = await adminFetch(`/api/admin/participants/${p.id}/assignments`);
      setHistory((json.history as AssignmentHistoryRow[]) ?? []);
    } catch (err) {
      console.error("Error fetching assignment history:", err);
      setError(err instanceof Error ? err.message : "Failed to load assignment history");
    } finally {
      setIsLoadingHistory(false);
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
              <option value="removed">Removed</option>
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
          <table className="w-full">
            <thead className="bg-slate-100 border-b border-slate-100">
              <tr>
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Name</th>
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Phone</th>
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Email</th>
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Assigned Mentor</th>
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Status</th>
                <th className="text-right px-6 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredParticipants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                    {searchQuery || statusFilter !== "all" || mentorFilter !== "all"
                      ? "No participants match your filters"
                      : "No participants found"}
                  </td>
                </tr>
              ) : (
                filteredParticipants.map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => {
                      setFormError(null);
                      setEditingParticipant(p);
                    }}
                  >
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-900">{p.name || "—"}</p>
                      <p className="text-xs text-slate-500">Created {formatDate(p.created_at ?? null)}</p>
                    </td>
                    <td className="px-6 py-4 text-slate-700">{formatPhone(p.phone_number)}</td>
                    <td className="px-6 py-4 text-slate-700">{p.email || "—"}</td>
                    <td className="px-6 py-4">
                      {p.assigned_mentor ? (
                        <div>
                          <p className="font-semibold text-slate-900">{p.assigned_mentor.mentor_name || "—"}</p>
                          <p className="text-xs text-slate-500">{p.assigned_mentor.mentor_email || ""}</p>
                        </div>
                      ) : (
                        <span className="text-slate-500">Unassigned</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {p.is_active === false ? (
                        <span className="inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-200 text-slate-700">
                          Removed
                        </span>
                      ) : (
                        <span className="inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-100 text-green-700">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openHistory(p)}
                          className="text-slate-600 hover:text-slate-900"
                        >
                          Details
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(p)}
                          className={p.is_active === false ? "text-green-600 hover:text-green-700" : "text-red-600 hover:text-red-700"}
                        >
                          {p.is_active === false ? "Restore" : "Remove"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isInviteModalOpen && (
        <InviteParticipantModal
          onClose={() => {
            setIsInviteModalOpen(false);
            setFormError(null);
          }}
          onSubmit={handleCreateParticipant}
          isSaving={isSaving}
          error={formError}
        />
      )}

      {isAddModalOpen && (
        <AddParticipantModal
          onClose={() => {
            setIsAddModalOpen(false);
            setFormError(null);
          }}
          onSubmit={(payload) => handleCreateParticipant({ ...payload, sendInvite: false })}
          isSaving={isSaving}
          error={formError}
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
          onViewHistory={() => openHistory(editingParticipant)}
          isSaving={isSaving}
          error={formError}
        />
      )}

      {historyParticipant && (
        <AssignmentHistoryModal
          participant={historyParticipant}
          history={history}
          isLoading={isLoadingHistory}
          onClose={() => setHistoryParticipant(null)}
        />
      )}
    </div>
  );
}

function InviteParticipantModal({
  onClose,
  onSubmit,
  isSaving,
  error,
}: {
  onClose: () => void;
  onSubmit: (payload: CreateParticipantPayload) => Promise<void>;
  isSaving: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!name.trim()) {
      setLocalError("Name is required.");
      return;
    }

    if (!phone.trim()) {
      setLocalError("Phone number is required.");
      return;
    }

    const e164Phone = toE164(phone);
    if (!e164Phone) {
      setLocalError("Invalid phone number. Enter 10+ digits (e.g., 555-123-4567 or +15551234567).");
      return;
    }

    await onSubmit({
      email,
      name: name.trim(),
      phone_number: e164Phone,
      sendInvite: true,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Invite Participant</h2>
            <p className="text-sm text-slate-500">Sends an email invite to join the pilot</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {(error || localError) && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200">
              <p className="text-sm text-red-600">{localError ?? error}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input 
              id="name" 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              placeholder="Jane Doe" 
              required 
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="participant@example.com"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input 
              id="phone" 
              value={phone} 
              onChange={(e) => setPhone(e.target.value)} 
              placeholder="+15551234567" 
              required 
            />
            <p className="text-xs text-slate-500">Use E.164 format for SMS features.</p>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isSaving || !email || !name || !phone} 
              className="flex-1 bg-teal-500 hover:bg-teal-600 text-white"
            >
              {isSaving ? "Sending..." : "Send Invite"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddParticipantModal({
  onClose,
  onSubmit,
  isSaving,
  error,
}: {
  onClose: () => void;
  onSubmit: (payload: CreateParticipantPayload) => Promise<void>;
  isSaving: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!name.trim()) {
      setLocalError("Name is required.");
      return;
    }

    if (!phone.trim()) {
      setLocalError("Phone number is required.");
      return;
    }

    const e164Phone = toE164(phone);
    if (!e164Phone) {
      setLocalError("Invalid phone number. Enter 10+ digits (e.g., 555-123-4567 or +15551234567).");
      return;
    }

    await onSubmit({
      email,
      name: name.trim(),
      phone_number: e164Phone,
      sendInvite: false,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Add Participant</h2>
            <p className="text-sm text-slate-500">Create participant directly (no email invite)</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {(error || localError) && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200">
              <p className="text-sm text-red-600">{localError ?? error}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="add-name">Name</Label>
            <Input 
              id="add-name" 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              placeholder="Jane Doe" 
              required 
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-email">Email</Label>
            <Input
              id="add-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="participant@example.com"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-phone">Phone</Label>
            <Input 
              id="add-phone" 
              value={phone} 
              onChange={(e) => setPhone(e.target.value)} 
              placeholder="+15551234567" 
              required 
            />
            <p className="text-xs text-slate-500">Use E.164 format for SMS features.</p>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isSaving || !email || !name || !phone} 
              className="flex-1 bg-teal-500 hover:bg-teal-600 text-white"
            >
              {isSaving ? "Adding..." : "Add Participant"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditParticipantModal({
  participant,
  onClose,
  onSubmit,
  onViewHistory,
  isSaving,
  error,
}: {
  participant: ParticipantRow;
  onClose: () => void;
  onSubmit: (payload: UpdateParticipantPayload) => Promise<void>;
  onViewHistory: () => void;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Edit Participant</h2>
            <p className="text-xs text-slate-500">ID: {participant.id}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
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
              <p className="font-semibold text-slate-900">
                {participant.assigned_mentor.mentor_name || "—"}{" "}
                <span className="font-normal text-slate-500">
                  {participant.assigned_mentor.mentor_email ? `(${participant.assigned_mentor.mentor_email})` : ""}
                </span>
              </p>
            ) : (
              <p className="font-semibold text-slate-900">Unassigned</p>
            )}
            <div className="mt-3">
              <Button type="button" variant="outline" size="sm" onClick={onViewHistory}>
                View assignment history
              </Button>
            </div>
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
      </div>
    </div>
  );
}

function AssignmentHistoryModal({
  participant,
  history,
  isLoading,
  onClose,
}: {
  participant: ParticipantRow;
  history: AssignmentHistoryRow[];
  isLoading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Participant Details</h2>
            <p className="text-sm text-slate-600">
              {participant.name || "—"} · {formatPhone(participant.phone_number)} · {participant.email || "—"}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <p className="text-sm text-slate-500 mb-1">Current assigned mentor</p>
            {participant.assigned_mentor ? (
              <p className="font-semibold text-slate-900">
                {participant.assigned_mentor.mentor_name || "—"}{" "}
                <span className="font-normal text-slate-500">
                  {participant.assigned_mentor.mentor_email ? `(${participant.assigned_mentor.mentor_email})` : ""}
                </span>
              </p>
            ) : (
              <p className="font-semibold text-slate-900">Unassigned</p>
            )}
          </div>

          <div className="bg-white rounded-2xl border-2 border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-100">
              <h3 className="font-bold text-slate-900">Assignment History</h3>
            </div>

            {isLoading ? (
              <div className="p-8 text-center text-slate-500">Loading history...</div>
            ) : history.length === 0 ? (
              <div className="p-8 text-center text-slate-500">No assignment history</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="text-left px-6 py-3 text-xs font-bold text-slate-600 uppercase">Mentor</th>
                      <th className="text-left px-6 py-3 text-xs font-bold text-slate-600 uppercase">Assigned</th>
                      <th className="text-left px-6 py-3 text-xs font-bold text-slate-600 uppercase">Ended</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {history.map((h) => (
                      <tr key={h.id} className="hover:bg-slate-50">
                        <td className="px-6 py-4">
                          <p className="font-semibold text-slate-900">{h.mentor?.name || h.mentor?.email || "—"}</p>
                          <p className="text-xs text-slate-500">{h.mentor?.email || ""}</p>
                        </td>
                        <td className="px-6 py-4 text-slate-700">{formatDate(h.assigned_at)}</td>
                        <td className="px-6 py-4 text-slate-700">{formatDate(h.unassigned_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

