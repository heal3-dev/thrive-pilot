"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import PrivacyContent from "@/components/privacy-content";
import ConsentContent from "@/components/consent-content";

export default function ConsentPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [ackPrivacy, setAckPrivacy] = useState(false);
  const [ackConsent, setAckConsent] = useState(false);
  const [ackSms, setAckSms] = useState(false);

  // Handle auth from invite link hash fragments (#access_token=...)
  // The @supabase/ssr browser client does NOT auto-detect hash fragments,
  // so we must manually extract tokens and call setSession.
  useEffect(() => {
    const handleAuth = async () => {
      const hash = window.location.hash;
      
      if (hash) {
        const params = new URLSearchParams(hash.substring(1));
        
        // Check for errors in hash (expired/used tokens)
        const hashError = params.get('error');
        if (hashError) {
          const errorDesc = params.get('error_description')?.replace(/\+/g, ' ');
          setError(errorDesc || 'Your invite link is invalid or has expired. Please request a new invitation.');
          window.history.replaceState(null, '', window.location.pathname);
          return;
        }
        
        // Extract tokens from hash
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        
        if (accessToken && refreshToken) {
          // Set the session manually
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          
          if (sessionError) {
            console.error('[CONSENT] Error setting session:', sessionError);
            setError('Failed to verify your invitation. Please try again.');
            return;
          }
          
          // Clear hash from URL
          window.history.replaceState(null, '', window.location.pathname);
          setIsReady(true);
          return;
        }
      }
      
      // No hash fragment - check for existing session
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setIsReady(true);
      } else {
        router.replace("/");
      }
    };

    handleAuth();
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

  if (!isReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 to-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-xl border-2 border-slate-100 max-w-2xl w-full p-8">
          <div className="text-center">
            {error ? (
              <>
                <p className="text-red-600 font-semibold mb-4">{error}</p>
                <p className="text-slate-500 text-sm">Please contact your administrator for a new invitation.</p>
              </>
            ) : (
              <>
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500 mb-4"></div>
                <p className="text-slate-600">Verifying your invitation...</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 to-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl border-2 border-slate-100 max-w-2xl w-full p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Welcome to the Thrive Pilot</h1>
          <p className="text-slate-600">Please review and accept the information below to continue.</p>
        </div>

        <div className="bg-slate-50 rounded-xl p-6 mb-6 border border-slate-100 max-h-[50vh] overflow-y-auto space-y-8">
          <section>
            <h2 className="font-semibold text-slate-900 mb-3">Privacy Policy</h2>
            <PrivacyContent />
          </section>

          <div className="border-t border-slate-200" />

          <section>
            <h2 className="font-semibold text-slate-900 mb-3">Participant Consent Form</h2>
            <ConsentContent />
          </section>
        </div>

        <div className="space-y-3 mb-6">
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              checked={ackPrivacy}
              onChange={(e) => setAckPrivacy(e.target.checked)}
            />
            <span>I have read and understood the Privacy Policy.</span>
          </label>
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              checked={ackConsent}
              onChange={(e) => setAckConsent(e.target.checked)}
            />
            <span>I have read and understood the Participant Consent Form.</span>
          </label>
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              checked={ackSms}
              onChange={(e) => setAckSms(e.target.checked)}
            />
            <span>I consent to receiving outreach communications (including SMS) from assigned peer mentors.</span>
          </label>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 mb-4">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <Button
          onClick={handleConsent}
          disabled={isSubmitting || !ackPrivacy || !ackConsent || !ackSms}
          className="w-full bg-teal-500 hover:bg-teal-600 text-white font-semibold py-3 rounded-xl"
        >
          {isSubmitting ? "Processing..." : "I Agree & Continue"}
        </Button>

        <p className="text-xs text-center text-slate-500 mt-4">
          By clicking &quot;I Agree &amp; Continue,&quot; you confirm your informed consent to participate in the Thrive Pilot.
        </p>
      </div>
    </div>
  );
}
