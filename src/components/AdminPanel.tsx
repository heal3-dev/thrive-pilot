"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useDashboard } from "@/app/dashboard/layout";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";
import { MentorManagement } from "@/components/admin/MentorManagement";
import { AssignmentManagement } from "@/components/admin/AssignmentManagement";
import { ParticipantManagement } from "./admin/ParticipantManagement";
import { MessageViewer } from "./admin/MessageViewer";
import { AddMentorModal } from "./admin/modals/AddMentorModal";
import { AddParticipantModal } from "./admin/modals/AddParticipantModal";
import { InviteParticipantModal } from "./admin/modals/InviteParticipantModal";
import { AssignMentorModal } from "./admin/modals/AssignMentorModal";

type AdminTab = "dashboard" | "mentors" | "participants" | "assignments" | "messages" | "garmin-trends";

type Stats = {
  totalMentors: number;
  totalParticipants: number;
  messagesToday: number;
  activeAssignments: number;
  connectedGarmin: number;
};

// Parse tab from URL hash
function getTabFromHash(): AdminTab {
  if (typeof window === "undefined") return "dashboard";
  const hash = window.location.hash.slice(1); // Remove #
  const validTabs: AdminTab[] = ["dashboard", "mentors", "participants", "assignments", "messages", "garmin-trends"];
  return validTabs.includes(hash as AdminTab) ? (hash as AdminTab) : "dashboard";
}

/**
 * Garmin Trends tab with demo mode toggle.
 */
function GarminTrendsTab({ onBack }: { onBack: () => void }) {
  const [demoMode, setDemoMode] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("adminDemoMode") === "true";
    }
    return false;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("adminDemoMode", String(demoMode));
    }
  }, [demoMode]);

  return (
    <div className="h-full min-h-0 flex flex-col gap-4">
      <div className="flex items-center justify-between shrink-0">
        <BackButton onClick={onBack} />
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDemoMode(!demoMode)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
              demoMode
                ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
            }`}
          >
            {demoMode ? 'Exit Demo' : 'Demo Mode'}
          </button>
          <h2 className="text-xl font-bold text-slate-900">
            Participant Trends
            {demoMode && (
              <span className="ml-2 inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200">
                DEMO
              </span>
            )}
          </h2>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <ParticipantManagement mode="trends" initialGarminFilter="connected" demoMode={demoMode} />
      </div>
    </div>
  );
}

/**
 * AdminPanel - Admin dashboard with stats and navigation
 * Implements TICKET #15A: Admin Dashboard - Stats & Navigation
 */
export function AdminPanel() {
  const router = useRouter();
  const { mentor } = useDashboard();
  const isAdmin = mentor.role === "admin";

  // Initialize from URL hash for back button support
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Track which modal to open when navigating to a tab
  const [pendingModal, setPendingModal] = useState<string | null>(null);
  
  // Dashboard quick action modals
  const [activeModal, setActiveModal] = useState<"add-mentor" | "add-participant" | "invite-participant" | "create-assignment" | null>(null);

  // Sync tab state with URL hash for back button support
  useEffect(() => {
    // Set initial tab from hash
    setActiveTab(getTabFromHash());
    
    // Listen for back/forward navigation
    const handlePopState = () => {
      setActiveTab(getTabFromHash());
      setPendingModal(null); // Clear any pending modal on navigation
    };
    
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Update URL hash when tab changes (for back button support)
  const navigateToTab = useCallback((tab: AdminTab, modal?: string) => {
    const currentHash = window.location.hash.slice(1);
    // Use empty hash for dashboard to keep URL clean
    const newHash = tab === "dashboard" ? "" : `#${tab}`;
    const currentPath = window.location.pathname;
    
    if (currentHash !== (tab === "dashboard" ? "" : tab)) {
      // Push to history so back button works
      window.history.pushState(null, "", tab === "dashboard" ? currentPath : `${currentPath}${newHash}`);
    }
    setActiveTab(tab);
    setPendingModal(modal ?? null);
  }, []);

  // Admin-only access guard (defense-in-depth; dashboard routing should already enforce this)
  useEffect(() => {
    if (!isAdmin) {
      router.replace("/dashboard");
    }
  }, [isAdmin, router]);

  // Fetch all stats
  const fetchStats = useCallback(async () => {
    try {
      // Get today's date range (UTC)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();

      // Parallel fetch all stats
      const [mentorsRes, participantsRes, messagesRes, assignmentsRes, garminRes] = await Promise.all([
        supabase.from("mentors").select("id", { count: "exact", head: true }).neq("role", "admin"),
        supabase.from("participants").select("id", { count: "exact", head: true }),
        supabase
          .from("sms_messages")
          .select("id", { count: "exact", head: true })
          .gte("created_at", todayISO),
        supabase.from("mentor_assignments").select("id", { count: "exact", head: true }),
        supabase.from("participants").select("id", { count: "exact", head: true }).not("garmin_user_id", "is", null),
      ]);

      // Check for errors
      if (mentorsRes.error) throw mentorsRes.error;
      if (participantsRes.error) throw participantsRes.error;
      if (messagesRes.error) throw messagesRes.error;
      if (assignmentsRes.error) throw assignmentsRes.error;

      setStats({
        totalMentors: mentorsRes.count ?? 0,
        totalParticipants: participantsRes.count ?? 0,
        messagesToday: messagesRes.count ?? 0,
        activeAssignments: assignmentsRes.count ?? 0,
        connectedGarmin: (garminRes?.count ?? 0),
      });
      setError(null);
    } catch (err) {
      console.error("Error fetching stats:", err);
      setError("Failed to load dashboard stats");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    if (!isAdmin) return;
    fetchStats();
  }, [fetchStats, isAdmin]);

  // Real-time updates for all relevant tables
  useEffect(() => {
    if (!isAdmin) return;
    const channel = supabase
      .channel("admin-stats")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mentors" },
        () => fetchStats()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "participants" },
        () => fetchStats()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sms_messages" },
        () => fetchStats()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mentor_assignments" },
        () => fetchStats()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchStats, isAdmin]);

  const tabs: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      ),
    },
    {
      id: "mentors",
      label: "Mentors",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
    {
      id: "participants",
      label: "Participants",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
    },
    {
      id: "assignments",
      label: "Assignments",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      ),
    },
    {
      id: "messages",
      label: "Messages",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
    },
    {
      id: "garmin-trends",
      label: "Trends",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      ),
    },
  ];

  if (!isAdmin) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border-2 border-red-100 dark:border-red-900 p-8 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-red-50 dark:bg-red-950/40 flex items-center justify-center">
          <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <p className="text-slate-900 dark:text-white font-semibold mb-1">Admin access required</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          You don&apos;t have permission to view the admin dashboard.
        </p>
        <Button variant="outline" onClick={() => router.replace("/dashboard")}>
          Back to dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-6">
      {/* Tab Navigation */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-slate-100 dark:border-slate-800 p-3">
        <div className="flex gap-3">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => navigateToTab(tab.id)}
            className={`inline-flex items-center justify-center gap-2 px-8 py-2.5 rounded-lg text-sm font-semibold transition-colors flex-1 cursor-pointer ${
              activeTab === tab.id
                ? "bg-teal-500 text-white shadow-md shadow-teal-500/25"
                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
        </div>
      </div>

      {/* Tab Content */}
      <div
        className={`flex-1 min-h-0 ${
          activeTab === "messages" ||
          activeTab === "garmin-trends" ||
          activeTab === "participants" ||
          activeTab === "mentors" ||
          activeTab === "assignments"
            ? "overflow-hidden"
            : "overflow-y-auto"
        }`}
      >
        {activeTab === "dashboard" && (
          <DashboardTab 
            stats={stats} 
            isLoading={isLoading} 
            error={error} 
            onNavigate={(tab) => navigateToTab(tab)}
            onQuickAction={(action) => {
              if (action === "view-messages") {
                navigateToTab("messages");
              } else {
                setActiveModal(action);
              }
            }}
          />
        )}
        {activeTab === "mentors" && (
          <MentorManagement 
            initialModal={pendingModal === "add-mentor" ? "add" : undefined}
            key={pendingModal}
          />
        )}
        {activeTab === "participants" && (
          <ParticipantManagement 
            initialModal={
              pendingModal === "add-participant" ? "add" : 
              pendingModal === "invite-participant" ? "invite" : 
              undefined
            }
            key={pendingModal}
          />
        )}
        {activeTab === "assignments" && (
          <AssignmentManagement 
            initialModal={pendingModal === "create-assignment" ? "assign" : undefined}
            key={pendingModal}
          />
        )}
        {activeTab === "messages" && <MessageViewer onBack={() => navigateToTab("dashboard")} />}
        {activeTab === "garmin-trends" && (
          <GarminTrendsTab onBack={() => navigateToTab("dashboard")} />
        )}
      </div>

      {/* Quick Action Modals */}
      {activeModal === "add-mentor" && (
        <AddMentorModal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            fetchStats();
            // Optional: Show success toast globally or rely on modal's own feedback (which currently doesn't persist after close)
            // But fetchStats will update the counters immediately.
          }}
        />
      )}
      {activeModal === "add-participant" && (
        <AddParticipantModal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          onSuccess={() => fetchStats()}
        />
      )}
      {activeModal === "invite-participant" && (
        <InviteParticipantModal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          onSuccess={() => fetchStats()}
        />
      )}
      {activeModal === "create-assignment" && (
        <AssignMentorModal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          onSuccess={() => fetchStats()}
        />
      )}
    </div>
  );
}

/**
 * Dashboard Tab - Stats overview
 */
function DashboardTab({
  stats,
  isLoading,
  error,
  onNavigate,
  onQuickAction,
}: {
  stats: Stats | null;
  isLoading: boolean;
  error: string | null;
  onNavigate: (tab: AdminTab) => void;
  onQuickAction: (action: "add-mentor" | "add-participant" | "invite-participant" | "create-assignment" | "view-messages") => void;
}) {
  if (error) {
    return (
      <div className="bg-white rounded-2xl border-2 border-red-100 p-8 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-red-50 flex items-center justify-center">
          <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <p className="text-slate-900 font-semibold mb-1">Error loading stats</p>
        <p className="text-sm text-slate-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* System Overview */}
      <div className="bg-white rounded-2xl border-2 border-slate-100 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">System Overview</h2>
            <p className="text-sm text-slate-500">Real-time statistics across the platform</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Mentors"
            value={stats?.totalMentors}
            isLoading={isLoading}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            }
            color="teal"
            onClick={() => onNavigate("mentors")}
          />
          <StatCard
            title="Total Participants"
            value={stats?.totalParticipants}
            isLoading={isLoading}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            }
            color="blue"
            onClick={() => onNavigate("participants")}
          />
          <StatCard
            title="Active Assignments"
            value={stats?.activeAssignments}
            isLoading={isLoading}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            }
            color="amber"
            onClick={() => onNavigate("assignments")}
          />
          <StatCard
            title="Messages Today"
            value={stats?.messagesToday}
            isLoading={isLoading}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            }
            color="purple"
            onClick={() => onNavigate("messages")}
          />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-2xl border-2 border-slate-100 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Quick Actions</h2>
            <p className="text-sm text-slate-500">Common tasks and shortcuts</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <QuickAction
            title="Add Mentor"
            description="Create a new mentor account"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            }
            color="teal"
            onClick={() => onQuickAction("add-mentor")}
          />
          <QuickAction
            title="Add Participant"
            description="Register a new participant"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            }
            color="blue"
            onClick={() => onQuickAction("add-participant")}
          />
          <QuickAction
            title="Invite Participant"
            description="Send email invitation"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            }
            color="teal"
            onClick={() => onQuickAction("invite-participant")}
          />
          <QuickAction
            title="Create Assignment"
            description="Assign mentor to participant"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            }
            color="amber"
            onClick={() => onQuickAction("create-assignment")}
          />
          <QuickAction
            title="View Messages"
            description="Browse all conversations"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            }
            color="purple"
            onClick={() => onQuickAction("view-messages")}
          />
        </div>
      </div>


      {/* Garmin Insights */}
      <div className="bg-white rounded-2xl border-2 border-slate-100 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Garmin Insights</h2>
            <p className="text-sm text-slate-500">Device connection and activity trends</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Participant Trends"
            value={stats?.connectedGarmin}
            isLoading={isLoading}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
            color="purple"
            onClick={() => onNavigate("garmin-trends")}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Stat Card with loading skeleton
 */
function StatCard({
  title,
  value,
  icon,
  color,
  isLoading,
  onClick,
}: {
  title: string;
  value: number | undefined;
  icon: React.ReactNode;
  color: "teal" | "blue" | "purple" | "amber";
  isLoading: boolean;
  onClick?: () => void;
}) {
  const colorClasses = {
    teal: "bg-teal-50 text-teal-600",
    blue: "bg-blue-50 text-blue-600",
    purple: "bg-purple-50 text-purple-600",
    amber: "bg-amber-50 text-amber-600",
  };

  return (
    <div
      className={`bg-white dark:bg-slate-900 rounded-xl border-2 border-slate-100 dark:border-slate-800 p-5 ${onClick ? "cursor-pointer hover:border-slate-200 hover:shadow-sm transition-all" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorClasses[color]}`}>
          {icon}
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
          {isLoading ? (
            <div className="h-8 w-16 bg-slate-200 dark:bg-slate-800 rounded animate-pulse mt-1" />
          ) : (
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{value?.toLocaleString() ?? "—"}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Quick Action Card
 */
function QuickAction({
  title,
  description,
  icon,
  color,
  onClick,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  color: "teal" | "blue" | "purple" | "amber";
  onClick?: () => void;
}) {
  const colorClasses = {
    teal: "bg-teal-50 text-teal-600 group-hover:bg-teal-100",
    blue: "bg-blue-50 text-blue-600 group-hover:bg-blue-100",
    purple: "bg-purple-50 text-purple-600 group-hover:bg-purple-100",
    amber: "bg-amber-50 text-amber-600 group-hover:bg-amber-100",
  };

  return (
    <button 
      onClick={onClick}
      className="group p-4 rounded-xl bg-slate-50 hover:bg-slate-100 text-left transition-colors cursor-pointer"
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 transition-colors ${colorClasses[color]}`}>
        {icon}
      </div>
      <h3 className="font-semibold text-slate-900 text-sm">{title}</h3>
      <p className="text-xs text-slate-500 mt-1">{description}</p>
    </button>
  );
}
