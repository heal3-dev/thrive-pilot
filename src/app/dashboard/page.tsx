"use client";

import { useDashboard } from "./layout";
import { AdminPanel } from "@/components/AdminPanel";
import { MentorPanel } from "@/components/MentorPanel";

export default function DashboardPage() {
  const { mentor } = useDashboard();
  const isAdmin = mentor.role === "admin";

  return (
    <div className="h-full min-h-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="font-clash text-3xl font-bold text-slate-900">
          {isAdmin ? "Admin Panel" : "Inbox"}
        </h1>
        <p className="mt-2 text-base text-slate-500">
          {isAdmin
            ? "Manage mentors, participants, and system settings."
            : "Manage your inbox and participant health trends."}
        </p>
      </div>

      {/* Role-based Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isAdmin ? <AdminPanel /> : <MentorPanel />}
      </div>
    </div>
  );
}
