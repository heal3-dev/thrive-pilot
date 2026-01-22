"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function SuccessPage() {
  // Sign out user after showing success (they don't need to stay logged in)
  useEffect(() => {
    const signOutAfterDelay = async () => {
      // Wait a moment so the page loads properly
      setTimeout(async () => {
        await supabase.auth.signOut();
      }, 5000);
    };
    signOutAfterDelay();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 to-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl border-2 border-slate-100 max-w-lg w-full p-8 text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-3xl font-bold text-slate-900 mb-3">Welcome to Thrive!</h1>
        
        <p className="text-lg text-slate-600 mb-6">
          You have successfully joined the pilot program.
        </p>

        <div className="bg-teal-50 rounded-xl p-6 mb-6 border border-teal-100">
          <h2 className="font-semibold text-teal-800 mb-2">What happens next?</h2>
          <p className="text-teal-700 text-sm">
            Your assigned mentor will reach out to you via <strong>SMS</strong>. 
            Keep an eye on your phone for messages!
          </p>
        </div>

        <div className="space-y-3 text-left">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50">
            <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-teal-600 font-bold text-sm">1</span>
            </div>
            <div>
              <p className="font-medium text-slate-900 text-sm">Mentor Introduction</p>
              <p className="text-xs text-slate-500">Your mentor will send you a welcome message</p>
            </div>
          </div>
          
          <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50">
            <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-teal-600 font-bold text-sm">2</span>
            </div>
            <div>
              <p className="font-medium text-slate-900 text-sm">Regular Check-ins</p>
              <p className="text-xs text-slate-500">Expect daily or weekly messages to support your wellness journey</p>
            </div>
          </div>
          
          <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50">
            <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-teal-600 font-bold text-sm">3</span>
            </div>
            <div>
              <p className="font-medium text-slate-900 text-sm">Reply Anytime</p>
              <p className="text-xs text-slate-500">Feel free to respond to your mentor via SMS</p>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-500 mt-8">
          You can close this page now. Your phone is all you need!
        </p>
      </div>
    </div>
  );
}
