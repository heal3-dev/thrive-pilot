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
      <div className="bg-white rounded-3xl shadow-xl border-2 border-slate-100 max-w-2xl w-full p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Welcome to the Thrive Pilot</h1>
          <p className="text-slate-600">Please review and accept the information below to continue.</p>
        </div>

        <div className="bg-slate-50 rounded-xl p-6 mb-6 border border-slate-100 max-h-[50vh] overflow-y-auto space-y-6">
          {/* What Thrive is (and is not) */}
          <section>
            <h2 className="font-semibold text-slate-900 mb-3">What Thrive is (and is not)</h2>
            <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside ml-2">
              <li>Thrive is a <strong>voluntary, preventive support pilot</strong></li>
              <li>Thrive <strong>does not diagnose</strong> medical or mental health conditions</li>
              <li>Thrive <strong>does not provide clinical or medical advice</strong></li>
              <li>Thrive is <strong>not medical care</strong></li>
              <li>Thrive is <strong>not emergency response</strong></li>
              <li>Thrive is <strong>not used to evaluate performance or fitness for duty</strong></li>
            </ul>
            <p className="text-sm text-slate-600 mt-3">
              The goal is to support early, human check-ins before burnout, mental health leave, or psychological injury.
            </p>
          </section>

          {/* What data Thrive uses */}
          <section>
            <h2 className="font-semibold text-slate-900 mb-3">What data Thrive uses (with your consent)</h2>
            <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
              <li>Limited, <strong>trend-level indicators</strong> from your wearable device</li>
              <li>This may include:
                <ul className="list-[circle] list-inside ml-4 mt-1 space-y-1">
                  <li>Sleep duration and disruption (over time)</li>
                  <li>Recovery indicators (e.g., HRV trends, resting heart rate trends)</li>
                  <li>Stress or strain summaries</li>
                  <li>System-generated flags when patterns change from your personal baseline</li>
                </ul>
              </li>
            </ul>
            <p className="text-sm text-slate-600 mt-3 mb-2">Thrive does <strong>not</strong> collect:</p>
            <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
              <li>GPS or location data</li>
              <li>Medical records or diagnoses</li>
              <li>Clinical assessments or symptom screening</li>
              <li>Employment, performance, or HR data</li>
            </ul>
          </section>

          {/* How your data is used */}
          <section>
            <h2 className="font-semibold text-slate-900 mb-3">How your data is used</h2>
            <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
              <li>To establish your personal baseline</li>
              <li>To detect sustained physiological changes over time</li>
              <li>To prompt a supportive, non-clinical check-in when appropriate</li>
            </ul>
          </section>

          {/* What a system flag means */}
          <section>
            <h2 className="font-semibold text-slate-900 mb-3">What a system flag means</h2>
            <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
              <li>A flag means the system has identified a sustained change from your personal baseline</li>
              <li>Flags are sent to peer mentors to prompt a check-in</li>
              <li>A flag simply indicates that a supportive check-in may be helpful</li>
            </ul>
            <h2 className="font-semibold text-slate-900 mt-4 mb-3">What a flag does <em>not</em> mean</h2>
            <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
              <li>It is not a diagnosis</li>
              <li>It does not mean illness or injury</li>
              <li>It does not predict risk or outcomes</li>
              <li>It does not require any action from you</li>
            </ul>
          </section>

          {/* Who can access your data */}
          <section>
            <h2 className="font-semibold text-slate-900 mb-3">Who can access your data</h2>
            
            <h3 className="text-sm font-medium text-slate-800 mt-3 mb-1">You</h3>
            <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
              <li>Control your participation</li>
              <li>Choose what you share during any check-in conversation</li>
              <li>May withdraw from the pilot at any time</li>
            </ul>

            <h3 className="text-sm font-medium text-slate-800 mt-3 mb-1">Peer mentors</h3>
            <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
              <li>Can see high-level trends and system flags</li>
              <li>Do not have access to raw wearable data</li>
              <li>Cannot see sleep charts, HRV values, stress metrics, or detailed physiological data</li>
              <li>Do not interpret biometric data</li>
              <li>Do not provide clinical advice</li>
              <li>Rely only on what you voluntarily share</li>
            </ul>

            <h3 className="text-sm font-medium text-slate-800 mt-3 mb-1">Platform administrator (pilot only)</h3>
            <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
              <li>Oversees system operations and outreach coordination</li>
              <li>Does not routinely review raw biometric data</li>
              <li>Any deeper access is:
                <ul className="list-[circle] list-inside ml-4 mt-1 space-y-1">
                  <li>Rare</li>
                  <li>Logged</li>
                  <li>Time-limited</li>
                  <li>Restricted to technical troubleshooting or participant-requested support</li>
                </ul>
              </li>
            </ul>
          </section>

          {/* Data storage and protection */}
          <section>
            <h2 className="font-semibold text-slate-900 mb-3">Data storage and protection</h2>
            <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
              <li>Data is stored securely <strong>in Canada</strong></li>
              <li>Encrypted in transit and at rest</li>
              <li>Role-based access controls are used</li>
              <li>Access is logged and monitored</li>
              <li>Data is retained only for the duration of the pilot</li>
              <li>Data is deleted or anonymized if you withdraw</li>
            </ul>
          </section>

          {/* Your choice */}
          <section>
            <h2 className="font-semibold text-slate-900 mb-3">Your choice</h2>
            <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
              <li>Participation is <strong>voluntary</strong></li>
              <li>You may opt out at any time without penalty</li>
            </ul>
          </section>

          {/* Consent */}
          <section className="bg-teal-50 -mx-6 -mb-6 p-6 rounded-b-xl border-t border-teal-100">
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
