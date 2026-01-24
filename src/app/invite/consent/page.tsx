"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

export default function ConsentPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if user is authenticated (came from magic link)
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // User not authenticated, redirect to login
        router.replace("/");
      }
    };
    checkAuth();
  }, [router]);

  const handleConsent = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Session expired. Please use the invite link again.");
        return;
      }

      // Call API to update consent (uses admin client to bypass RLS)
      const response = await fetch("/api/invite/consent", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to record consent");
      }

      // Redirect to success page
      router.push("/invite/success");
    } catch (err) {
      console.error("Consent error:", err);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 to-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl border-2 border-slate-100 max-w-lg w-full p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-teal-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Welcome to Thrive Pilot</h1>
          <p className="text-slate-600">Please review and accept the terms below to continue.</p>
        </div>

        <div className="bg-slate-50 rounded-xl p-6 mb-6 border border-slate-100">
          <h2 className="font-semibold text-slate-900 mb-3">Program Consent</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>By participating in the Thrive pilot program, you agree to:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Receive SMS messages from your assigned mentor</li>
              <li>Share your wellness data for program purposes</li>
              <li>Participate in the program activities</li>
            </ul>
            <p className="text-xs text-slate-500 mt-4">
              Your data is handled securely and used only for the pilot program. 
              You can opt out at any time by contacting your mentor.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 mb-4">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <Button
          onClick={handleConsent}
          disabled={isSubmitting}
          className="w-full bg-teal-500 hover:bg-teal-600 text-white font-semibold py-3 rounded-xl"
        >
          {isSubmitting ? "Processing..." : "I Agree & Continue"}
        </Button>

        <p className="text-xs text-center text-slate-500 mt-4">
          By clicking &quot;I Agree&quot;, you consent to participate in the Thrive pilot program.
        </p>
      </div>
    </div>
  );
}
