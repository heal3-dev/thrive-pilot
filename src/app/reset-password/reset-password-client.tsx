"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPasswordClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isRecoveryFlow = useMemo(() => {
    // Supabase recovery links typically include `type=recovery` and tokens in the URL hash.
    // We don't need to parse tokens manually here; supabase-js will hydrate the session
    // from the hash via onAuthStateChange.
    return searchParams.get("type") === "recovery" || true;
  }, [searchParams]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session?.user) {
        setError(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password || password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message || "Failed to update password.");
        return;
      }
      setSuccess(true);
      setTimeout(() => router.replace("/dashboard"), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update password.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6 sm:px-8 py-12 bg-white">
      <div className="w-full max-w-md mx-auto">
        <div className="text-center mb-10">
          <h1 className="font-clash text-3xl font-bold tracking-tight text-slate-900">
            Set a new password
          </h1>
          <p className="mt-3 text-base font-medium text-slate-500">
            {isRecoveryFlow
              ? "Choose a new password for your mentor account."
              : "Choose a new password."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {error && (
            <div className="p-4 rounded-xl bg-red-50 border-2 border-red-200">
              <p className="text-base font-semibold text-red-600">{error}</p>
            </div>
          )}

          {success && (
            <div className="p-4 rounded-xl bg-green-50 border-2 border-green-200">
              <p className="text-base font-semibold text-green-700">
                Password updated. Redirecting…
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Label htmlFor="password" className="text-base font-bold text-slate-700">
              New password
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              disabled={isSaving}
              minLength={6}
              required
              autoComplete="new-password"
            />
          </div>

          <div className="flex flex-col gap-3">
            <Label htmlFor="confirmPassword" className="text-base font-bold text-slate-700">
              Confirm new password
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
              disabled={isSaving}
              minLength={6}
              required
              autoComplete="new-password"
            />
          </div>

          <Button
            type="submit"
            disabled={isSaving}
            className="w-full mt-2 bg-teal-500 hover:bg-teal-600 text-white shadow-lg shadow-teal-500/30 hover:shadow-teal-600/40"
          >
            {isSaving ? "Saving…" : "Save new password"}
          </Button>

          <p className="text-sm text-slate-500 text-center">
            If you didn’t request this, you can close this page.
          </p>
        </form>
      </div>
    </main>
  );
}

