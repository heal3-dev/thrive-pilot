"use client";

import { useDashboard } from "./layout";
import { AdminPanel } from "@/components/AdminPanel";
import { MentorPanel } from "@/components/MentorPanel";

export default function DashboardPage() {
  const { mentor } = useDashboard();
  const isAdmin = mentor.role === "admin";

  return (
    <div className="h-full min-h-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col">
      {/* Page Header (admins already have an ADMIN badge in the global header) */}
      {!isAdmin && (
        <div className="mb-4">
          <h1 className="font-clash text-2xl font-bold text-slate-900">Inbox</h1>
          <p className="mt-1.5 text-base text-slate-500">Manage your inbox and participant health trends.</p>
        </div>
      )}

      {/* Role-based Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isAdmin ? <AdminPanel /> : <MentorPanel />}
      </div>
    </div>
  );
}
