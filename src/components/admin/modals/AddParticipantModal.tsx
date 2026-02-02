"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { toE164 } from "@/lib/utils";
import { useUniquenessCheck } from "@/hooks/useUniquenessCheck";

type AddParticipantModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
};

export function AddParticipantModal({ isOpen, onClose, onSuccess }: AddParticipantModalProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [phoneFormatError, setPhoneFormatError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const getAccessToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  };

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

    setIsSaving(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Authentication required");

      const res = await fetch("/api/admin/participants", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email,
          name: name.trim(),
          phone_number: e164Phone,
          sendInvite: false,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((json && json.error) || "Failed to create participant");
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      console.error("Error creating participant:", err);
      setLocalError(err instanceof Error ? err.message : "Failed to create participant");
    } finally {
      setIsSaving(false);
    }
  };

  const hasFieldErrors = !!fieldErrors.email || !!fieldErrors.phone_number || !!phoneFormatError;
  const isCheckingAny = isChecking.email || isChecking.phone_number;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Participant"
      subtitle="Create participant directly (no email invite)"
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {localError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200">
            <p className="text-sm text-red-600">{localError}</p>
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
            {isSaving ? "Create" : "Create Participant"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
