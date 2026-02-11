"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Handle auth state: existing sessions, invite hash fragments, and errors
  useEffect(() => {
    // First check for auth errors in URL hash (expired links, etc.)
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.substring(1));
      const hashError = params.get('error');
      const errorCode = params.get('error_code');
      const errorDescription = params.get('error_description');

      if (hashError === 'access_denied' && errorCode === 'otp_expired') {
        setError('Your invite link has expired. Please contact your administrator for a new invitation.');
        window.history.replaceState(null, '', window.location.pathname);
        return;
      } else if (hashError) {
        setError(errorDescription || 'Authentication failed. Please try again or contact support.');
        window.history.replaceState(null, '', window.location.pathname);
        return;
      }
    }

    // Listen for auth state changes (handles both existing sessions and
    // new sessions from invite hash fragments like #access_token=...)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user) {
          const role = session.user.user_metadata?.role;
          if (role === 'participant') {
            router.replace('/invite/consent');
          } else {
            router.replace('/dashboard');
          }
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  // Simple email validation
  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // Client-side validation
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address");
      return;
    }
    if (!password) {
      setError("Password is required");
      return;
    }

    setIsLoading(true);

    try {
      const { error: authError } = await signIn(email, password);

      if (authError) {
        setError(authError.message);
        return;
      }

      // Redirect to dashboard on success
      router.replace("/dashboard");
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 sm:px-8 py-12 bg-white">
      <div className="w-full max-w-md mx-auto">
        {/* Brand Title */}
        <div className="text-center mb-10">
          <h1 className="font-clash text-4xl font-bold tracking-tight text-slate-900">
            Thrive Pilot
          </h1>
          <p className="mt-3 text-lg font-medium text-slate-500">
            Sign in to your mentor account
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Error Message */}
          {error && (
            <div className="p-4 rounded-xl bg-red-50 border-2 border-red-200">
              <p className="text-base font-semibold text-red-600 flex items-center gap-3">
                <svg
                  className="w-5 h-5 flex-shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                {error}
              </p>
            </div>
          )}

          {/* Email Input */}
          <div className="flex flex-col gap-3">
            <Label htmlFor="email" className="text-base font-bold text-slate-700">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="mentor@heal-3.com"
              disabled={isLoading}
            />
          </div>

          {/* Password Input */}
          <div className="flex flex-col gap-3">
            <Label htmlFor="password" className="text-base font-bold text-slate-700">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={isLoading}
            />
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 bg-teal-500 hover:bg-teal-600 text-white shadow-lg shadow-teal-500/30 hover:shadow-teal-600/40"
          >
            {isLoading ? (
              <span className="inline-flex items-center gap-2">
                <svg
                  className="animate-spin h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Signing in...
              </span>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
