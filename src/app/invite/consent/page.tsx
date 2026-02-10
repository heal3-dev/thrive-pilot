"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import PrivacyContent from "@/components/privacy-content";

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
        console.error("[CONSENT] Full error response:", data);
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
      <div className="bg-white rounded-3xl shadow-xl border-2 border-slate-100 max-w-2xl w-full p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Welcome to the Thrive Pilot</h1>
          <p className="text-slate-600">Please review and accept the information below to continue.</p>
        </div>

        <div className="bg-slate-50 rounded-xl p-6 mb-6 border border-slate-100 max-h-[50vh] overflow-y-auto">
          <PrivacyContent />

          {/* Consent */}
          <section className="bg-teal-50 -mx-6 -mb-6 mt-6 p-6 rounded-b-xl border-t border-teal-100">
            <h2 className="font-semibold text-slate-900 mb-3">Consent</h2>
            <p className="text-sm text-slate-700 mb-2">By clicking <strong>&quot;I Agree &amp; Continue,&quot;</strong> you confirm that:</p>
            <ul className="text-sm text-slate-700 list-disc list-inside ml-2 space-y-1">
              <li>You understand how your data will be used, stored, and protected</li>
              <li>You understand that Thrive does not diagnose or provide clinical advice</li>
              <li>You consent to participate in the Thrive pilot</li>
              <li>You consent to receive SMS messages from your assigned mentor</li>
            </ul>
          </section>
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
          By clicking &quot;I Agree,&quot; you consent to participate in the Thrive pilot program.
        </p>
      </div>
    </div>
  );
}
