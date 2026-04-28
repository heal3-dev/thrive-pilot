import { Suspense } from "react";
import ResetPasswordClient from "./reset-password-client";

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center px-6 sm:px-8 py-12 bg-white">
          <div className="w-full max-w-md mx-auto text-center text-slate-500">
            Loading…
          </div>
        </main>
      }
    >
      <ResetPasswordClient />
    </Suspense>
  );
}

