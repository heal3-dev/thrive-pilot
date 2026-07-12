"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { AddMentorModal } from "./modals/AddMentorModal";
import type { Mentor } from "@/types";

type StatusFilter = "all" | "active" | "inactive";

type MentorFormData = {
  name: string;
  email: string;
  password?: string;
  role: string;
};

/**
 * MentorManagement - Admin component for managing mentors
 * Implements TICKET #15B: Mentor Management Tab
 */
export function MentorManagement({ initialModal }: { initialModal?: "add" }) {
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [isSendingRecoveryForMentorId, setIsSendingRecoveryForMentorId] = useState<string | null>(null);
  
  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(initialModal === "add");
  const [editingMentor, setEditingMentor] = useState<Mentor | null>(null);
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

  // Fetch mentors
  const fetchMentors = useCallback(async () => {
    try {
      const json = await adminFetch("/api/admin/mentors");
      setMentors((json.mentors as Mentor[]) ?? []);
      setError(null);
    } catch (err) {
      console.error("Error fetching mentors:", err);
      setError("Failed to load mentors");
    } finally {
      setIsLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    // Avoid triggering `react-hooks/set-state-in-effect` by deferring.
    queueMicrotask(() => {
      void fetchMentors();
    });
  }, [fetchMentors]);

  // Real-time updates
  useEffect(() => {
    const channel = supabase
      .channel("mentors-management")
      .on("postgres_changes", { event: "*", schema: "public", table: "mentors" }, () => fetchMentors())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchMentors]);

  // Filter mentors
  const filteredMentors = mentors.filter((mentor) => {
    const matchesSearch =
      searchQuery === "" ||
      mentor.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      mentor.email?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && mentor.is_active !== false) ||
      (statusFilter === "inactive" && mentor.is_active === false);

    return matchesSearch && matchesStatus;
  });

// handleAddMentor removed (using AddMentorModal)

  // Edit mentor
  const handleEditMentor = async (formData: MentorFormData) => {
    if (!editingMentor) return;
    setIsSaving(true);
    setFormError(null);

    try {
      await adminFetch(`/api/admin/mentors/${editingMentor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          role: formData.role,
        }),
      });

      setEditingMentor(null);
      setSuccessMessage("Mentor updated successfully");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error("Error updating mentor:", err);
      setFormError(err instanceof Error ? err.message : "Failed to update mentor");
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle active status
  const handleToggleActive = async (mentor: Mentor) => {
    try {
      await adminFetch(`/api/admin/mentors/${mentor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !(mentor.is_active !== false) }),
      });

      setSuccessMessage(`Mentor ${mentor.is_active ? "deactivated" : "activated"} successfully`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error("Error toggling mentor status:", err);
      setError(err instanceof Error ? err.message : "Failed to update mentor status");
    }
  };

  const handleSendPasswordRecovery = async (mentor: Mentor) => {
    setError(null);
    setSuccessMessage(null);
    setIsSendingRecoveryForMentorId(mentor.id);
    try {
      await adminFetch(`/api/admin/mentors/${mentor.id}/send-password-recovery`, {
        method: "POST",
      });
      setSuccessMessage(`Password reset email sent to ${mentor.email ?? "mentor"}`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error("Error sending password recovery:", err);
      setError(err instanceof Error ? err.message : "Failed to send password reset email");
    } finally {
      setIsSendingRecoveryForMentorId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border-2 border-slate-100 p-8 flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3 text-slate-500">
          <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="font-medium">Loading mentors...</span>
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

      {/* Header with search and actions */}
      <div className="bg-white rounded-2xl border-2 border-slate-100 p-3 shrink-0">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center min-w-0 sm:flex-nowrap sm:overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Input
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-48 h-10 rounded-lg shadow-none text-sm placeholder:text-sm"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="h-10 px-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 shadow-none w-full sm:w-[8.5rem]"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              onClick={() => setIsAddModalOpen(true)}
              className="bg-teal-500 hover:bg-teal-600 text-white cursor-pointer px-3 w-full sm:w-auto"
            >
              <svg className="w-4 h-4 mr-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Mentor
            </Button>
          </div>
        </div>
      </div>

      {/* Mentors Table */}
      <div className="bg-white rounded-2xl border-2 border-slate-100 overflow-hidden flex-1 min-h-0">
        <div className="h-full overflow-auto">
          <table className="w-full table-fixed min-w-[800px]">
            <colgroup>
              <col className="w-[20%]" />
              <col className="w-[22%]" />
              <col className="w-[14%]" />
              <col className="w-[16%]" />
              <col className="w-[28%]" />
            </colgroup>
            <thead className="bg-slate-100 border-b border-slate-100 sticky top-0 z-10">
              <tr>
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Name</th>
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Email</th>
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Role</th>
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Status</th>
                <th className="text-right px-6 py-4 text-xs font-bold text-slate-700 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMentors.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                    {searchQuery || statusFilter !== "all" ? "No mentors match your filters" : "No mentors found"}
                  </td>
                </tr>
              ) : (
                filteredMentors.map((mentor) => (
                  <tr key={mentor.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-900 whitespace-normal break-words leading-snug">
                        {mentor.name || "—"}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-slate-600 whitespace-normal break-words leading-snug">
                        {mentor.email || "—"}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 capitalize">
                        {mentor.role || "mentor"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {mentor.is_active !== false ? (
                        <span className="inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-100 text-green-700">Active</span>
                      ) : (
                        <span className="inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-100 text-red-700">Inactive</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingMentor(mentor)}
                          className="text-slate-600 hover:text-slate-900"
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(mentor)}
                          className={mentor.is_active !== false ? "text-red-600 hover:text-red-700" : "text-green-600 hover:text-green-700"}
                        >
                          {mentor.is_active !== false ? "Deactivate" : "Activate"}
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

      {/* Add Mentor Modal (direct creation with password) */}
      {isAddModalOpen && (
        <AddMentorModal
          isOpen={true}
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={() => {
            fetchMentors();
            setSuccessMessage("Mentor added successfully");
            setTimeout(() => setSuccessMessage(null), 3000);
          }}
        />
      )}

      {/* Edit Mentor Modal */}
      {editingMentor && (
        <MentorModal
          title="Edit Mentor"
          mode="edit"
          mentor={editingMentor}
          onClose={() => { setEditingMentor(null); setFormError(null); }}
          onSubmit={handleEditMentor}
          onSendPasswordResetEmail={() => {
            void handleSendPasswordRecovery(editingMentor);
          }}
          isSendingPasswordResetEmail={isSendingRecoveryForMentorId === editingMentor.id}
          isSaving={isSaving}
          error={formError}
        />
      )}
    </div>
  );
}

/**
 * Mentor Add/Edit Modal
 */
function MentorModal({
  title,
  mode,
  mentor,
  onClose,
  onSubmit,
  onSendPasswordResetEmail,
  isSendingPasswordResetEmail,
  isSaving,
  error,
}: {
  title: string;
  mode: "create" | "edit";
  mentor?: Mentor;
  onClose: () => void;
  onSubmit: (data: MentorFormData) => Promise<void>;
  onSendPasswordResetEmail?: () => void;
  isSendingPasswordResetEmail?: boolean;
  isSaving: boolean;
  error: string | null;
}) {
  const [name, setName] = useState(mentor?.name || "");
  const [email, setEmail] = useState(mentor?.email || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(mentor?.role || "mentor");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({ 
      name, 
      email, 
      password: mode === "create" ? password : undefined,
      role,
    });
  };

  const getButtonText = () => {
    if (isSaving) {
      return mode === "create" ? "Creating..." : "Saving...";
    }
    return mode === "create" ? "Add Mentor" : "Save Changes";
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={title}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="John Doe"
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
            placeholder="john@example.com"
            required
            disabled={false}
          />
        </div>

        {mode === "create" && (
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 6 characters"
              minLength={6}
              required
            />
            <p className="text-xs text-slate-400">Mentor will use this password to log in</p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm cursor-pointer"
          >
            <option value="mentor">Mentor</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        {mode === "edit" && mentor && (
          <div className="pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onSendPasswordResetEmail}
              disabled={!mentor.email || Boolean(isSendingPasswordResetEmail)}
              className="w-full justify-center cursor-pointer"
              title={!mentor.email ? "Mentor has no email on record" : "Send reset password email"}
            >
              {isSendingPasswordResetEmail ? "Sending reset password email..." : "Send reset password email"}
            </Button>
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1 cursor-pointer">
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving} className="flex-1 bg-teal-500 hover:bg-teal-600 text-white cursor-pointer">
            {getButtonText()}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
