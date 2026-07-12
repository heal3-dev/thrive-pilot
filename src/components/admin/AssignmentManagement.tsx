"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { AssignMentorModal } from "./modals/AssignMentorModal";
import type { Mentor, Participant } from "@/types";

type AssignmentFilter = "all" | "active" | "unassigned";

type AssignmentStatus = "active" | "ended" | "never_assigned";

type AssignmentRow = {
  id: string;
  mentor_id: string | null;
  participant_id: string;
  assigned_at: string | null;
  unassigned_at: string | null;
  participant: Participant | null;
  mentor: Mentor | null;
  status: AssignmentStatus;
};

/**
 * AssignmentManagement - Admin component for managing mentor-participant assignments
 * Implements TICKET #15B: Assignment Management Tab
 */
export function AssignmentManagement({ initialModal }: { initialModal?: "assign" }) {
  const [allRows, setAllRows] = useState<AssignmentRow[]>([]);
  const [unassignedParticipants, setUnassignedParticipants] = useState<Participant[]>([]);
  const [activeMentors, setActiveMentors] = useState<Mentor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AssignmentFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [mentorFilter, setMentorFilter] = useState<string>("all"); // mentor id | "all" | "unassigned"

  // Modal states
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(initialModal === "assign");
  const [reassigningAssignment, setReassigningAssignment] = useState<AssignmentRow | null>(null);
  const [unassigningAssignment, setUnassigningAssignment] = useState<AssignmentRow | null>(null);
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

  // Fetch all data
  const fetchData = useCallback(async () => {
    try {
      const json = await adminFetch("/api/admin/assignments");
      setAllRows((json.displayRows as AssignmentRow[]) ?? []);
      setUnassignedParticipants((json.unassignedParticipants as Participant[]) ?? []);
      setActiveMentors((json.activeMentors as Mentor[]) ?? []);

      setError(null);
    } catch (err) {
      console.error("Error fetching data:", err);
      setError(err instanceof Error ? err.message : "Failed to load assignments");
    } finally {
      setIsLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    // Avoid triggering `react-hooks/set-state-in-effect` by deferring.
    queueMicrotask(() => {
      fetchData();
    });
  }, [fetchData]);

  // Real-time updates
  useEffect(() => {
    const channel = supabase
      .channel("assignments-management")
      .on("postgres_changes", { event: "*", schema: "public", table: "mentor_assignments" }, () => fetchData())
      .on("postgres_changes", { event: "*", schema: "public", table: "participants" }, () => fetchData())
      .on("postgres_changes", { event: "*", schema: "public", table: "mentors" }, () => fetchData())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchData]);

  // Filter rows based on status - API already puts never_assigned first
  const displayRows = allRows.filter((row) => {
    if (filter === "active") return row.status === "active";
    if (filter === "unassigned") return row.status === "never_assigned" || row.status === "ended";
    return true; // "all"
  }).filter((row) => {
    const q = searchQuery.trim().toLowerCase();
    const participant = row.participant;
    const mentor = row.mentor;

    const matchesSearch =
      q.length === 0 ||
      (participant?.name ?? "").toLowerCase().includes(q) ||
      (participant?.email ?? "").toLowerCase().includes(q) ||
      (participant?.phone_number ?? "").toLowerCase().includes(q);

    // For ended/active assignments, use row.mentor_id. For never_assigned, mentor_id is null.
    const isUnassigned = row.status === "never_assigned" || !row.mentor_id;
    const matchesMentor =
      mentorFilter === "all" ||
      (mentorFilter === "unassigned" && isUnassigned) ||
      (!isUnassigned && row.mentor_id === mentorFilter) ||
      // Fallback for ended rows if mentor_id is present but mentor object missing
      (!isUnassigned && mentor?.id === mentorFilter);

    return matchesSearch && matchesMentor;
  });

// handleCreateAssignment removed (using AssignMentorModal)

  // Reassign mentor
  const handleReassign = async (newMentorId: string) => {
    if (!reassigningAssignment) return;
    setIsSaving(true);
    setFormError(null);

    try {
      await adminFetch("/api/admin/assignments/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId: reassigningAssignment.id,
          participantId: reassigningAssignment.participant_id,
          newMentorId,
        }),
      });

      setReassigningAssignment(null);
      setSuccessMessage("Mentor reassigned successfully");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error("Error reassigning mentor:", err);
      setFormError(err instanceof Error ? err.message : "Failed to reassign mentor");
    } finally {
      setIsSaving(false);
    }
  };

  // Unassign mentor
  const handleUnassign = async () => {
    if (!unassigningAssignment) return;
    setIsSaving(true);
    setFormError(null);

    try {
      await adminFetch(`/api/admin/assignments/${unassigningAssignment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      setUnassigningAssignment(null);
      setSuccessMessage("Mentor unassigned successfully");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error("Error unassigning mentor:", err);
      setFormError(err instanceof Error ? err.message : "Failed to unassign mentor");
    } finally {
      setIsSaving(false);
    }
  };

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    // Ensure UTC interpretation if timezone is missing
    let s = dateStr;
    if (s.includes("T") && !s.endsWith("Z") && !s.includes("+")) {
      s += "Z";
    }
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Format phone
  const formatPhone = (phone: string) => {
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length === 11 && cleaned.startsWith("1")) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phone;
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border-2 border-slate-100 p-8 flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3 text-slate-500">
          <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="font-medium">Loading assignments...</span>
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
    <div className="h-full min-h-0 flex flex-col gap-4">
      {/* Success Message */}
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

      {/* Header with filter and actions */}
      <div className="bg-white rounded-2xl border-2 border-slate-100 p-4 shrink-0">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center flex-1 min-w-0">
            <div className="flex gap-1.5 shrink-0">
              {(["all", "active", "unassigned"] as AssignmentFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`h-10 px-4 rounded-lg text-base font-bold transition-colors cursor-pointer ${
                    filter === f
                      ? "bg-teal-500 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {f === "active" ? "Active" : f === "unassigned" ? "Unassigned" : "All"}
                </button>
              ))}
            </div>

            <Input
              placeholder="Search by participant name, phone, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:flex-1 h-10 rounded-lg shadow-none text-sm placeholder:text-sm min-w-0"
            />

            <select
              value={mentorFilter}
              onChange={(e) => setMentorFilter(e.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 shadow-none sm:w-56 shrink-0"
            >
              <option value="all">All Mentors</option>
              <option value="unassigned">Unassigned</option>
              {activeMentors
                .filter((m) => m.is_active !== false && m.role !== "admin")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.email || "Unnamed mentor"}
                  </option>
                ))}
            </select>
          </div>

          <Button
            size="sm"
            onClick={() => setIsAssignModalOpen(true)}
            disabled={unassignedParticipants.length === 0 || activeMentors.length === 0}
            className="bg-teal-500 hover:bg-teal-600 text-white shrink-0 px-3"
          >
            <svg className="w-4 h-4 mr-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Assign Mentor
          </Button>
        </div>
      </div>

      {/* Assignments Table */}
      {(
        <div className="bg-white rounded-2xl border-2 border-slate-100 overflow-hidden flex-1 min-h-0">
          <div className="h-full overflow-auto">
            <table className="w-full table-fixed min-w-[800px]">
              <colgroup>
                <col className="w-[25%]" />
                <col className="w-[25%]" />
                <col className="w-[15%]" />
                <col className="w-[18%]" />
                <col className="w-[17%]" />
              </colgroup>
              <thead className="bg-slate-100 border-b border-slate-100 sticky top-0 z-10">
                <tr>
                  <th className="text-left px-6 py-4 text-xs font-bold text-slate-700 uppercase">Participant</th>
                  <th className="text-left px-6 py-4 text-xs font-bold text-slate-700 uppercase">Mentor</th>
                  <th className="text-left px-6 py-4 text-xs font-bold text-slate-700 uppercase">Assigned</th>
                  <th className="text-left px-6 py-4 text-xs font-bold text-slate-700 uppercase">Status</th>
                  <th className="text-right px-6 py-4 text-xs font-bold text-slate-700 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                      No assignments found
                    </td>
                  </tr>
                ) : (
                  displayRows.map((assignment) => {
                    return (
                      <tr key={assignment.id} className="hover:bg-slate-50">
                        <td className="px-6 py-4">
                          <p className="font-semibold text-slate-900">
                            {assignment.participant?.name || "—"}
                          </p>
                          <p className="text-sm text-slate-600">
                            {assignment.participant ? formatPhone(assignment.participant.phone_number) : ""}
                          </p>
                          <p className="text-xs text-slate-500">{assignment.participant?.email || ""}</p>
                        </td>
                        <td className="px-6 py-4">
                          {assignment.status === "never_assigned" ? (
                            <p className="text-sm text-slate-400 italic">Not yet assigned</p>
                          ) : (
                            <>
                              <p className="font-semibold text-slate-900">{assignment.mentor?.name || "—"}</p>
                              <p className="text-xs text-slate-500">{assignment.mentor?.email || ""}</p>
                            </>
                          )}
                        </td>
                        <td className="px-6 py-4 text-slate-600">
                          {assignment.status === "never_assigned" ? "—" : formatDate(assignment.assigned_at)}
                        </td>
                        <td className="px-6 py-4">
                          {assignment.status === "never_assigned" ? (
                            <span className="inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-100 text-amber-700">
                              Unassigned
                            </span>
                          ) : assignment.status === "active" ? (
                            <span className="inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-100 text-green-700">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600">
                              Ended {formatDate(assignment.unassigned_at)}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            {assignment.status === "never_assigned" ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setIsAssignModalOpen(true)}
                                className="text-teal-600 hover:text-teal-700"
                              >
                                Assign
                              </Button>
                            ) : (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setReassigningAssignment(assignment)}
                                  className="text-slate-600 hover:text-slate-900"
                                >
                                  Reassign
                                </Button>
                                {assignment.status === "active" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setUnassigningAssignment(assignment)}
                                    className="text-red-600 hover:text-red-700"
                                  >
                                    Unassign
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Assign Modal */}
      {isAssignModalOpen && (
        <AssignMentorModal
          isOpen={true}
          onClose={() => setIsAssignModalOpen(false)}
          onSuccess={() => {
            fetchData();
            setSuccessMessage("Assignment created successfully");
            setTimeout(() => setSuccessMessage(null), 3000);
          }}
        />
      )}

      {/* Reassign Modal */}
      {reassigningAssignment && (
        <ReassignModal
          assignment={reassigningAssignment}
          mentors={activeMentors}
          onClose={() => { setReassigningAssignment(null); setFormError(null); }}
          onSubmit={handleReassign}
          isSaving={isSaving}
          error={formError}
        />
      )}

      {/* Unassign Modal */}
      {unassigningAssignment && (
        <UnassignModal
          assignment={unassigningAssignment}
          onClose={() => { setUnassigningAssignment(null); setFormError(null); }}
          onConfirm={handleUnassign}
          isSaving={isSaving}
          error={formError}
        />
      )}
    </div>
  );
}



/**
 * Reassign Mentor Modal
 */
function ReassignModal({
  assignment,
  mentors,
  onClose,
  onSubmit,
  isSaving,
  error,
}: {
  assignment: AssignmentRow;
  mentors: Mentor[];
  onClose: () => void;
  onSubmit: (newMentorId: string) => Promise<void>;
  isSaving: boolean;
  error: string | null;
}) {
  const [newMentorId, setNewMentorId] = useState("");

  // Filter out current mentor (only if assignment is still active)
  const availableMentors = assignment.unassigned_at
    ? mentors
    : mentors.filter((m) => m.id !== assignment.mentor_id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newMentorId) {
      await onSubmit(newMentorId);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Reassign Mentor"
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="p-4 rounded-xl bg-slate-50">
          <p className="text-sm text-slate-500 mb-1">
            {assignment.unassigned_at ? "Previous Mentor" : "Current Mentor"}
          </p>
          <p className="font-semibold text-slate-900">{assignment.mentor?.name || assignment.mentor?.email || "Unknown"}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="newMentor">New Mentor</Label>
          <select
            id="newMentor"
            value={newMentorId}
            onChange={(e) => setNewMentorId(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
            required
          >
            <option value="">Select new mentor...</option>
            {availableMentors.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.email || "Unnamed Mentor"}
              </option>
            ))}
          </select>
        </div>

        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
          <p className="text-sm text-amber-700">
            {assignment.unassigned_at
              ? "This will create a new assignment with the selected mentor and activate the participant."
              : "This will end the current assignment and create a new one with the selected mentor."}
          </p>
        </div>

        <div className="flex gap-3 pt-4">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving || !newMentorId} className="flex-1 bg-teal-500 hover:bg-teal-600 text-white">
            {isSaving ? "Reassigning..." : "Confirm Reassign"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Unassign Mentor Confirmation Modal
 */
function UnassignModal({
  assignment,
  onClose,
  onConfirm,
  isSaving,
  error,
}: {
  assignment: AssignmentRow;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isSaving: boolean;
  error: string | null;
}) {
  const formatPhone = (phone: string) => {
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length >= 10) {
      return `+1 (${cleaned.slice(-10, -7)}) ${cleaned.slice(-7, -4)}-${cleaned.slice(-4)}`;
    }
    return phone;
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Unassign Mentor"
      size="md"
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <p className="text-slate-600">
          Are you sure you want to unassign this mentor from the participant?
        </p>

        <div className="p-4 rounded-xl bg-slate-50 space-y-3">
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Participant</p>
            <p className="font-semibold text-slate-900">{assignment.participant?.name || "—"}</p>
            <p className="text-sm text-slate-600">
              {assignment.participant ? formatPhone(assignment.participant.phone_number) : ""}
            </p>
          </div>
          <div className="border-t border-slate-200 pt-3">
            <p className="text-xs text-slate-500 mb-0.5">Current Mentor</p>
            <p className="font-semibold text-slate-900">{assignment.mentor?.name || assignment.mentor?.email || "Unknown"}</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
          <p className="text-sm text-amber-700">
            This will end the current assignment. The participant will no longer be assigned to any mentor.
          </p>
        </div>

        <div className="flex gap-3 pt-4">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button 
            type="button" 
            onClick={onConfirm} 
            disabled={isSaving} 
            className="flex-1 bg-red-500 hover:bg-red-600 text-white"
          >
            {isSaving ? "Unassigning..." : "Confirm Unassign"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
