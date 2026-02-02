"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { Mentor, Participant } from "@/types";

type AssignMentorModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
};

export function AssignMentorModal({ isOpen, onClose, onSuccess }: AssignMentorModalProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [participantId, setParticipantId] = useState("");
  const [mentorId, setMentorId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getAccessToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  };

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const token = await getAccessToken();
      if (!token) throw new Error("Authentication required");

      const res = await fetch("/api/admin/assignments", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || "Failed to load options");

      setParticipants(json.unassignedParticipants || []);
      setMentors(json.activeMentors || []);
    } catch (err) {
      console.error("Error loading assignment options:", err);
      setError(err instanceof Error ? err.message : "Failed to load options");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!participantId || !mentorId) return;

    setIsSaving(true);
    setError(null);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Authentication required");

      const res = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ participantId, mentorId }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || "Failed to create assignment");

      onSuccess?.();
      onClose();
    } catch (err) {
      console.error("Error creating assignment:", err);
      setError(err instanceof Error ? err.message : "Failed to create assignment");
    } finally {
      setIsSaving(false);
    }
  };

  const formatPhone = (phone: string) => {
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length >= 10) {
      return `(${cleaned.slice(-10, -7)}) ${cleaned.slice(-7, -4)}-${cleaned.slice(-4)}`;
    }
    return phone;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Assign Mentor to Participant"
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="participant">Participant</Label>
          <select
            id="participant"
            value={participantId}
            onChange={(e) => setParticipantId(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
            required
            disabled={isLoading}
          >
            <option value="">{isLoading ? "Loading..." : "Select participant..."}</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || "—"} • {formatPhone(p.phone_number)}{p.email ? ` • ${p.email}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="mentor">Mentor</Label>
          <select
            id="mentor"
            value={mentorId}
            onChange={(e) => setMentorId(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
            required
            disabled={isLoading}
          >
            <option value="">{isLoading ? "Loading..." : "Select mentor..."}</option>
            {mentors.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.email || "Unnamed Mentor"}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3 pt-4">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button 
            type="submit" 
            disabled={isSaving || !participantId || !mentorId || isLoading} 
            className="flex-1 bg-teal-500 hover:bg-teal-600 text-white"
          >
            {isSaving ? "Assigning..." : "Assign"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
