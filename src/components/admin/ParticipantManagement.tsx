"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { Mentor, Participant } from "@/types";

// Debounced uniqueness check hook
type FieldErrors = {
  email?: string;
  phone_number?: string;
};

function useUniquenessCheck(getAccessToken: () => Promise<string | null>) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isChecking, setIsChecking] = useState<{ email?: boolean; phone_number?: boolean }>({});
  const debounceTimers = useRef<{ email?: NodeJS.Timeout; phone_number?: NodeJS.Timeout }>({});
  const abortControllers = useRef<{ email?: AbortController; phone_number?: AbortController }>({});

  const checkField = useCallback(
    async (field: "email" | "phone_number", value: string) => {
      // Clear previous timer
      if (debounceTimers.current[field]) {
        clearTimeout(debounceTimers.current[field]);
      }

      // Abort previous request
      if (abortControllers.current[field]) {
        abortControllers.current[field]?.abort();
      }

      // Clear error immediately if value is empty
      if (!value.trim()) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
        setIsChecking((prev) => ({ ...prev, [field]: false }));
        return;
      }

      // For email, validate format first
      if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        setErrors((prev) => ({ ...prev, email: undefined }));
        setIsChecking((prev) => ({ ...prev, email: false }));
        return;
      }

      setIsChecking((prev) => ({ ...prev, [field]: true }));

      debounceTimers.current[field] = setTimeout(async () => {
        const controller = new AbortController();
        abortControllers.current[field] = controller;

        try {
          const token = await getAccessToken();
          if (!token) {
            setIsChecking((prev) => ({ ...prev, [field]: false }));
            return;
          }

          const res = await fetch("/api/admin/participants/check", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ [field]: value }),
            signal: controller.signal,
          });

          if (!res.ok) {
            setIsChecking((prev) => ({ ...prev, [field]: false }));
            return;
          }

          const data = await res.json();
          setErrors((prev) => ({
            ...prev,
            [field]: data.errors?.[field] || undefined,
          }));
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            return; // Request was aborted, ignore
          }
          console.error("Uniqueness check failed:", err);
        } finally {
          setIsChecking((prev) => ({ ...prev, [field]: false }));
        }
      }, 400); // 400ms debounce
    },
    [getAccessToken]
  );

  const clearError = useCallback((field: "email" | "phone_number") => {
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setIsChecking((prev) => ({ ...prev, [field]: false }));
    // Clear pending timer for this field
    if (debounceTimers.current[field]) {
      clearTimeout(debounceTimers.current[field]);
    }
    // Abort pending request for this field
    if (abortControllers.current[field]) {
      abortControllers.current[field]?.abort();
    }
  }, []);

  const clearAllErrors = useCallback(() => {
    setErrors({});
    setIsChecking({});
    // Clear any pending timers
    if (debounceTimers.current.email) clearTimeout(debounceTimers.current.email);
    if (debounceTimers.current.phone_number) clearTimeout(debounceTimers.current.phone_number);
  }, []);

  return { errors, isChecking, checkField, clearError, clearAllErrors };
}

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

  // Handler for "Add Participant" - creates participant directly without invite
  const handleCreateParticipant = async (payload: CreateParticipantPayload) => {
    setIsSaving(true);
    setFormError(null);
    try {
      await adminFetch("/api/admin/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, sendInvite: false }),
      });

      setIsAddModalOpen(false);
      setSuccessMessage("Participant added successfully");
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error("Error creating participant:", err);
      setFormError(err instanceof Error ? err.message : "Failed to create participant");
    } finally {
      setIsSaving(false);
    }
  };

  // Handler for "Invite Participant" - sends invite email only, participant created on consent
  const handleInviteParticipant = async (payload: CreateParticipantPayload) => {
    setIsSaving(true);
    setFormError(null);
    try {
      await adminFetch("/api/admin/participants/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: payload.email,
          name: payload.name,
          phone_number: payload.phone_number,
        }),
      });

      setIsInviteModalOpen(false);
      setSuccessMessage(`Invite sent to ${payload.email}`);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error("Error sending invite:", err);
      setFormError(err instanceof Error ? err.message : "Failed to send invite");
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
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              <col className="w-[20%]" />
              <col className="w-[20%]" />
              <col className="w-[12%]" />
              <col className="w-[18%]" />
            </colgroup>
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
          onSubmit={handleInviteParticipant}
          isSaving={isSaving}
          error={formError}
          getAccessToken={getAccessToken}
        />
      )}

      {isAddModalOpen && (
        <AddParticipantModal
          onClose={() => {
            setIsAddModalOpen(false);
            setFormError(null);
          }}
          onSubmit={handleCreateParticipant}
          isSaving={isSaving}
          error={formError}
          getAccessToken={getAccessToken}
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
  getAccessToken,
}: {
  onClose: () => void;
  onSubmit: (payload: CreateParticipantPayload) => Promise<void>;
  isSaving: boolean;
  error: string | null;
  getAccessToken: () => Promise<string | null>;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [phoneFormatError, setPhoneFormatError] = useState<string | null>(null);

  const { errors: fieldErrors, isChecking, checkField, clearError } = useUniquenessCheck(getAccessToken);

  // Handle email change with validation
  const handleEmailChange = (value: string) => {
    setEmail(value);
    checkField("email", value);
  };

  // Handle phone change with validation
  const handlePhoneChange = (value: string) => {
    setPhone(value);
    setPhoneFormatError(null);
    
    // Only check uniqueness if format is valid
    const e164 = toE164(value);
    if (e164) {
      checkField("phone_number", e164);
    } else if (value.trim()) {
      // Clear phone uniqueness error when format is invalid (but keep email error)
      clearError("phone_number");
    }
  };

  // Validate phone format on blur
  const handlePhoneBlur = () => {
    if (phone.trim() && !toE164(phone)) {
      setPhoneFormatError("Invalid phone number. Enter 10+ digits (e.g., 555-123-4567 or +15551234567).");
    }
  };

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
      setPhoneFormatError("Invalid phone number. Enter 10+ digits (e.g., 555-123-4567 or +15551234567).");
      return;
    }

    await onSubmit({
      email,
      name: name.trim(),
      phone_number: e164Phone,
      sendInvite: true,
    });
  };

  const hasFieldErrors = !!fieldErrors.email || !!fieldErrors.phone_number || !!phoneFormatError;
  const isCheckingAny = isChecking.email || isChecking.phone_number;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Invite Participant"
      subtitle="Sends an email invite to join the pilot"
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
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
          <div className="relative">
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              placeholder="participant@example.com"
              required
              className={fieldErrors.email ? "border-red-300 focus:border-red-500 focus:ring-red-500" : ""}
            />
            {isChecking.email && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <svg className="animate-spin h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            )}
          </div>
          {fieldErrors.email && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <div className="relative">
            <Input 
              id="phone" 
              value={phone} 
              onChange={(e) => handlePhoneChange(e.target.value)}
              onBlur={handlePhoneBlur}
              placeholder="+15551234567" 
              required
              className={(fieldErrors.phone_number || phoneFormatError) ? "border-red-300 focus:border-red-500 focus:ring-red-500" : ""}
            />
            {isChecking.phone_number && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <svg className="animate-spin h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            )}
          </div>
          {(fieldErrors.phone_number || phoneFormatError) ? (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {phoneFormatError || fieldErrors.phone_number}
            </p>
          ) : (
            <p className="text-xs text-slate-500">Use E.164 format for SMS features.</p>
          )}
        </div>

        <div className="flex gap-3 pt-4">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button 
            type="submit" 
            disabled={isSaving || !email || !name || !phone || hasFieldErrors || isCheckingAny} 
            className="flex-1 bg-teal-500 hover:bg-teal-600 text-white disabled:opacity-50"
          >
            {isSaving ? "Sending..." : "Send Invite"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AddParticipantModal({
  onClose,
  onSubmit,
  isSaving,
  error,
  getAccessToken,
}: {
  onClose: () => void;
  onSubmit: (payload: CreateParticipantPayload) => Promise<void>;
  isSaving: boolean;
  error: string | null;
  getAccessToken: () => Promise<string | null>;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [phoneFormatError, setPhoneFormatError] = useState<string | null>(null);

  const { errors: fieldErrors, isChecking, checkField, clearError } = useUniquenessCheck(getAccessToken);

  // Handle email change with validation
  const handleEmailChange = (value: string) => {
    setEmail(value);
    checkField("email", value);
  };

  // Handle phone change with validation
  const handlePhoneChange = (value: string) => {
    setPhone(value);
    setPhoneFormatError(null);
    
    // Only check uniqueness if format is valid
    const e164 = toE164(value);
    if (e164) {
      checkField("phone_number", e164);
    } else if (value.trim()) {
      // Clear phone uniqueness error when format is invalid (but keep email error)
      clearError("phone_number");
    }
  };

  // Validate phone format on blur
  const handlePhoneBlur = () => {
    if (phone.trim() && !toE164(phone)) {
      setPhoneFormatError("Invalid phone number. Enter 10+ digits (e.g., 555-123-4567 or +15551234567).");
    }
  };

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
      setPhoneFormatError("Invalid phone number. Enter 10+ digits (e.g., 555-123-4567 or +15551234567).");
      return;
    }

    await onSubmit({
      email,
      name: name.trim(),
      phone_number: e164Phone,
      sendInvite: false,
    });
  };

  const hasFieldErrors = !!fieldErrors.email || !!fieldErrors.phone_number || !!phoneFormatError;
  const isCheckingAny = isChecking.email || isChecking.phone_number;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Add Participant"
      subtitle="Create participant directly (no email invite)"
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
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
          <div className="relative">
            <Input
              id="add-email"
              type="email"
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              placeholder="participant@example.com"
              required
              className={fieldErrors.email ? "border-red-300 focus:border-red-500 focus:ring-red-500" : ""}
            />
            {isChecking.email && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <svg className="animate-spin h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            )}
          </div>
          {fieldErrors.email && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="add-phone">Phone</Label>
          <div className="relative">
            <Input 
              id="add-phone" 
              value={phone} 
              onChange={(e) => handlePhoneChange(e.target.value)}
              onBlur={handlePhoneBlur}
              placeholder="+15551234567" 
              required
              className={(fieldErrors.phone_number || phoneFormatError) ? "border-red-300 focus:border-red-500 focus:ring-red-500" : ""}
            />
            {isChecking.phone_number && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <svg className="animate-spin h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            )}
          </div>
          {(fieldErrors.phone_number || phoneFormatError) ? (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {phoneFormatError || fieldErrors.phone_number}
            </p>
          ) : (
            <p className="text-xs text-slate-500">Use E.164 format for SMS features.</p>
          )}
        </div>

        <div className="flex gap-3 pt-4">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button 
            type="submit" 
            disabled={isSaving || !email || !name || !phone || hasFieldErrors || isCheckingAny} 
            className="flex-1 bg-teal-500 hover:bg-teal-600 text-white disabled:opacity-50"
          >
            {isSaving ? "Adding..." : "Add Participant"}
          </Button>
        </div>
      </form>
    </Modal>
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
    </Modal>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
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

