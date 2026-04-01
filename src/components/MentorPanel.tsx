"use client";

import { useCallback, useEffect, useState } from "react";
import { MentorInbox } from "@/components/MentorInbox";
import { ParticipantManagement } from "@/components/admin/ParticipantManagement";

type MentorTab = "inbox" | "health-trends";

function getTabFromHash(): MentorTab {
  if (typeof window === "undefined") return "inbox";
  const hash = window.location.hash.slice(1);
  const validTabs: MentorTab[] = ["inbox", "health-trends"];
  return validTabs.includes(hash as MentorTab) ? (hash as MentorTab) : "inbox";
}

export function MentorPanel() {
  const [activeTab, setActiveTab] = useState<MentorTab>(() => getTabFromHash());

  useEffect(() => {
    const handlePopState = () => setActiveTab(getTabFromHash());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigateToTab = useCallback((tab: MentorTab) => {
    const currentHash = window.location.hash.slice(1);
    if (currentHash !== tab) {
      window.history.pushState(null, "", `${window.location.pathname}#${tab}`);
    }
    setActiveTab(tab);
  }, []);

  return (
    <div className="h-full min-h-0 flex flex-col gap-6">
      <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-slate-100 dark:border-slate-800 p-3">
        <div className="flex gap-3">
          <button
            onClick={() => navigateToTab("inbox")}
            className={`inline-flex items-center justify-center gap-2 px-8 py-2.5 rounded-lg text-sm font-semibold transition-colors flex-1 cursor-pointer ${
              activeTab === "inbox"
                ? "bg-teal-500 text-white shadow-md shadow-teal-500/25"
                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Inbox
          </button>

          <button
            onClick={() => navigateToTab("health-trends")}
            className={`inline-flex items-center justify-center gap-2 px-8 py-2.5 rounded-lg text-sm font-semibold transition-colors flex-1 cursor-pointer ${
              activeTab === "health-trends"
                ? "bg-teal-500 text-white shadow-md shadow-teal-500/25"
                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            Health Trends
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "inbox" ? (
          <MentorInbox enableHealthPanel />
        ) : (
          <div className="h-full min-h-0 overflow-hidden">
            <ParticipantManagement mode="mentor-trends" />
          </div>
        )}
      </div>
    </div>
  );
}
