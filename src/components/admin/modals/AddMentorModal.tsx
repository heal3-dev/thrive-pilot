"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";

type AddMentorModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
};

export function AddMentorModal({ isOpen, onClose, onSuccess }: AddMentorModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("mentor");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAccessToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Authentication required");

      const res = await fetch("/api/admin/mentors", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          email,
          password,
          role,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((json && json.error) || "Failed to add mentor");
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      console.error("Error adding mentor:", err);
      setError(err instanceof Error ? err.message : "Failed to add mentor");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Mentor"
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
          />
        </div>

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

        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm cursor-pointer"
          >
            <option value="mentor">Mentor</option>
          </select>
        </div>

        <div className="flex gap-3 pt-4">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1 cursor-pointer">
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving} className="flex-1 bg-teal-500 hover:bg-teal-600 text-white cursor-pointer">
            {isSaving ? "Creating..." : "Add Mentor"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
