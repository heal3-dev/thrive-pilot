import type { Metadata } from "next";
import PrivacyContent from "@/components/privacy-content";

export const metadata: Metadata = {
  title: "Privacy Policy – Thrive Pilot",
  description: "How the Thrive Pilot uses and protects your data.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 to-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl border-2 border-slate-100 max-w-2xl w-full p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
          <p className="text-slate-600">
            How the Thrive Pilot collects, uses, and protects your data.
          </p>
        </div>

        <div className="bg-slate-50 rounded-xl p-6 border border-slate-100 max-h-[65vh] overflow-y-auto">
          <PrivacyContent />
        </div>

        <p className="text-xs text-center text-slate-400 mt-6">
          If you have questions about this policy, please contact the Thrive Pilot administrator.
        </p>
      </div>
    </div>
  );
}
