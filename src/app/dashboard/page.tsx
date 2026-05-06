"use client";

import { useDashboard } from "./layout";
import { AdminPanel } from "@/components/AdminPanel";
import { MentorPanel } from "@/components/MentorPanel";

export default function DashboardPage() {
  const { mentor } = useDashboard();
  const isAdmin = mentor.role === "admin";

  return (
    <div className="h-full min-h-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col">
      {/* Role-based Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isAdmin ? <AdminPanel /> : <MentorPanel />}
      </div>
    </div>
  );
}
