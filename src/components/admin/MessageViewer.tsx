"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";

// Types
type Mentor = {
  id: string;
  name: string | null;
  email: string | null;
  is_active: boolean;
};

type Participant = {
  id: string;
  name: string | null;
  phone_number: string;
  email: string | null;
  is_active: boolean;
  currentMentorId: string | null;
  lastMessage: Message | null;
  messageCount: number;
};

type Message = {
  id: string;
  participant_id: string;
  mentor_id: string | null;
  direction: "inbound" | "outbound";
  message_type: string;
  message_body: string;
  phone_number?: string;
  twilio_status: string | null;
  failure_reason: string | null;
  created_at: string;
  mentor?: { id: string; name: string | null; email: string | null } | null;
};

type MentorGroup = {
  mentor: Mentor | null;
  participants: Participant[];
  totalMessages: number;
};

type ThreadData = {
  participant: Participant;
  currentMentor: { id: string; name: string | null; email: string | null; assignedAt: string } | null;
  assignmentHistory: {
    id: string;
    mentor: { id: string; name: string | null; email: string | null } | null;
    assignedAt: string;
    unassignedAt: string | null;
  }[];
  messages: Message[];
  stats: {
    totalMessages: number;
    inboundCount: number;
    outboundCount: number;
    firstMessageDate: string | null;
    lastMessageDate: string | null;
  };
};

type ViewMode = "mentor" | "participant";
type DateRangePreset = "today" | "7d" | "30d" | "all";

/**
 * MessageViewer - Admin view for browsing all SMS conversations
 * Implements TICKET #16: Admin Panel - Message Thread Viewer
 */
export function MessageViewer({ onBack }: { onBack: () => void }) {
  // Data state
  const [mentorGroups, setMentorGroups] = useState<MentorGroup[]>([]);
  const [unassignedGroup, setUnassignedGroup] = useState<MentorGroup | null>(null);
  const [allParticipants, setAllParticipants] = useState<Participant[]>([]);
  const [allMentors, setAllMentors] = useState<Mentor[]>([]);

  // UI state
  const [viewMode, setViewMode] = useState<ViewMode>("mentor");
  const [expandedMentors, setExpandedMentors] = useState<Set<string>>(new Set());
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const [threadData, setThreadData] = useState<ThreadData | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [dateRange, setDateRange] = useState<DateRangePreset>("all");

  // Loading state
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mobile sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Admin fetch helper
  const adminFetch = useCallback(async (url: string) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error("Not authenticated");

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Request failed");
    }

    return response.json();
  }, []);

  const computeLocalPresetRange = useCallback(
    (preset: DateRangePreset): { from?: string; to?: string } => {
      if (preset === "all") return {};
      const now = new Date();
      const startOfTodayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const startOfTomorrowLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);

      if (preset === "today") {
        return { from: startOfTodayLocal.toISOString(), to: startOfTomorrowLocal.toISOString() };
      }

      const days = preset === "7d" ? 7 : 30;
      const start = new Date(startOfTodayLocal);
      start.setDate(start.getDate() - (days - 1));
      return { from: start.toISOString(), to: startOfTomorrowLocal.toISOString() };
    },
    []
  );

  // Fetch conversation list
  const fetchList = useCallback(async () => {
    setIsLoadingList(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);

      const { from, to } = computeLocalPresetRange(dateRange);
      if (from) params.set("dateFrom", from);
      if (to) params.set("dateTo", to);

      const queryString = params.toString();
      const url = `/api/admin/messages${queryString ? `?${queryString}` : ""}`;

      const data = await adminFetch(url);
      setMentorGroups(data.mentorGroups || []);
      setUnassignedGroup(data.unassignedGroup || null);
      setAllParticipants(data.allParticipants || []);
      setAllMentors(data.allMentors || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    } finally {
      setIsLoadingList(false);
    }
  }, [adminFetch, debouncedSearch, dateRange, computeLocalPresetRange]);

  // Fetch thread for selected participant
  const fetchThread = useCallback(async (participantId: string) => {
    setIsLoadingThread(true);

    try {
      const params = new URLSearchParams();
      if (dateRange !== "all") {
        const { from, to } = computeLocalPresetRange(dateRange);
        if (from) params.set("dateFrom", from);
        if (to) params.set("dateTo", to);
      }

      const qs = params.toString();
      const data = await adminFetch(`/api/admin/messages/${participantId}${qs ? `?${qs}` : ""}`);
      setThreadData(data);
    } catch (err) {
      console.error("Error fetching thread:", err);
      setThreadData(null);
    } finally {
      setIsLoadingThread(false);
    }
  }, [adminFetch, dateRange, computeLocalPresetRange]);

  // Initial fetch
  useEffect(() => {
    // Avoid triggering `react-hooks/set-state-in-effect` by deferring.
    queueMicrotask(() => {
      fetchList();
    });
  }, [fetchList]);

  // Fetch thread when participant selected
  useEffect(() => {
    if (selectedParticipantId) {
      // Avoid triggering `react-hooks/set-state-in-effect` by deferring.
      queueMicrotask(() => {
        fetchThread(selectedParticipantId);
        // On mobile, close sidebar when selecting
        if (window.innerWidth < 768) {
          setSidebarOpen(false);
        }
      });
    } else {
      // Avoid triggering `react-hooks/set-state-in-effect` by deferring.
      queueMicrotask(() => {
        setThreadData(null);
      });
    }
  }, [selectedParticipantId, fetchThread]);

  // Toggle mentor section
  const toggleMentor = (mentorId: string) => {
    setExpandedMentors((prev) => {
      const next = new Set(prev);
      if (next.has(mentorId)) {
        next.delete(mentorId);
      } else {
        next.add(mentorId);
      }
      return next;
    });
  };

  // Filtered participants for flat view
  const filteredParticipants = useMemo(() => {
    return allParticipants;
  }, [allParticipants]);

  // Format timestamp
  const formatTime = (timestamp: string | null | undefined) => {
    if (!timestamp) return "";
    const utcTimestamp = timestamp.endsWith("Z") ? timestamp : timestamp + "Z";
    const date = new Date(utcTimestamp);
    if (isNaN(date.getTime())) return "";

    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) {
      return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    } else if (isYesterday) {
      return "Yesterday";
    } else {
      const showYear = date.getFullYear() !== now.getFullYear();
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        ...(showYear ? { year: "numeric" } : {}),
      });
    }
  };

  // Format phone number
  const formatPhone = (phone: string) => {
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length === 11 && cleaned.startsWith("1")) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phone;
  };

  // Format date for grouping messages
  const formatDateGroup = (timestamp: string) => {
    const utcTimestamp = timestamp.endsWith("Z") ? timestamp : timestamp + "Z";
    const date = new Date(utcTimestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) return "Today";
    if (isYesterday) return "Yesterday";
    return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  };

  // Group messages by date
  const groupedMessages = useMemo(() => {
    if (!threadData?.messages) return [];

    const groups: { date: string; messages: Message[] }[] = [];
    let currentDate = "";

    for (const msg of threadData.messages) {
      const dateKey = new Date(msg.created_at).toDateString();
      if (dateKey !== currentDate) {
        currentDate = dateKey;
        groups.push({ date: formatDateGroup(msg.created_at), messages: [] });
      }
      groups[groups.length - 1].messages.push(msg);
    }

    return groups;
  }, [threadData?.messages]);

  // Auto-scroll to bottom when messages load
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [threadData?.messages]);

  // Get initials
  const getInitials = (name: string | null | undefined, email: string | null | undefined, fallback: string) => {
    if (name) {
      const parts = name.trim().split(/\s+/).filter(Boolean);
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      if (parts.length === 1) return parts[0][0].toUpperCase();
    }
    if (email) {
      const username = email.split("@")[0];
      return username.slice(0, 2).toUpperCase();
    }
    return fallback.slice(0, 2);
  };

  // Get status icon and color
  const getStatusDisplay = (status: string | null) => {
    switch (status) {
      case "delivered":
        return { icon: "✓✓", color: "text-green-500", label: "Delivered" };
      case "sent":
        return { icon: "✓", color: "text-blue-400", label: "Sent" };
      case "queued":
        return { icon: "◷", color: "text-slate-400", label: "Queued" };
      case "failed":
      case "undelivered":
        return { icon: "✕", color: "text-red-500", label: "Failed" };
      default:
        return { icon: "", color: "", label: status || "" };
    }
  };

  // Render participant item
  const renderParticipantItem = (participant: Participant, showMentor = false) => {
    const isSelected = selectedParticipantId === participant.id;

    return (
      <button
        key={participant.id}
        onClick={() => setSelectedParticipantId(participant.id)}
        className={`w-full p-3 text-left transition-colors cursor-pointer ${
          isSelected
            ? "bg-teal-50 dark:bg-teal-900/30 border-l-4 border-l-teal-500"
            : "hover:bg-slate-50 dark:hover:bg-slate-800 border-l-4 border-l-transparent"
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0 ${
              isSelected ? "bg-teal-500" : "bg-slate-400"
            }`}
          >
            {getInitials(participant.name, participant.email, participant.phone_number)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                {participant.name || "Unnamed"}
              </p>
              {participant.lastMessage && (
                <span className="text-xs text-slate-400 flex-shrink-0">
                  {formatTime(participant.lastMessage.created_at)}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 truncate">{formatPhone(participant.phone_number)}</p>
            {showMentor && (
              participant.currentMentorId ? (
                <p className="text-xs text-teal-600 dark:text-teal-400 mt-0.5">
                  {allMentors.find((m) => m.id === participant.currentMentorId)?.name || "Unknown mentor"}
                </p>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  Unassigned
                </p>
              )
            )}
            {participant.lastMessage && (
              <p className="text-xs text-slate-400 mt-1 truncate">
                {participant.lastMessage.direction === "outbound" ? "You: " : ""}
                {participant.lastMessage.message_body}
              </p>
            )}
          </div>
          {participant.messageCount > 0 && (
            <span className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
              {participant.messageCount}
            </span>
          )}
        </div>
      </button>
    );
  };

  return (
    // Fill the available dashboard content height (dashboard main is locked to viewport).
    // No browser scrolling; only inner panels scroll.
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <BackButton onClick={onBack} />
        </div>
        <div className="flex items-center gap-2">
          {/* Date range (desktop) */}
          <div className="hidden sm:block">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRangePreset)}
              className="h-9 px-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 shadow-none"
              aria-label="Date range"
            >
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All time</option>
            </select>
          </div>

          {/* View mode toggle */}
          <div className="hidden sm:flex gap-2">
            <Button
              variant={viewMode === "mentor" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("mentor")}
              className={`cursor-pointer ${viewMode === "mentor" ? "bg-teal-500 hover:bg-teal-600 text-white" : ""}`}
            >
              By Mentor
            </Button>
            <Button
              variant={viewMode === "participant" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("participant")}
              className={`cursor-pointer ${viewMode === "participant" ? "bg-teal-500 hover:bg-teal-600 text-white" : ""}`}
            >
              By Participant
            </Button>
          </div>

          {/* Mobile sidebar toggle */}
          <Button
            variant="outline"
            size="sm"
            className="md:hidden cursor-pointer"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </Button>
        </div>
      </div>

      {/* Main content - flex-1 with min-h-0 allows proper flex shrinking */}
      <div className="flex-1 flex h-full bg-white dark:bg-slate-900 rounded-2xl border-2 border-slate-100 dark:border-slate-800 overflow-hidden min-h-0">
        {/* Sidebar */}
        <div
          className={`${
            sidebarOpen ? "w-full md:w-80" : "hidden"
          } md:block h-full border-r-2 border-slate-100 dark:border-slate-800 flex flex-col flex-shrink-0 min-h-0`}
        >
          {/* Filters */}
          <div className="p-3 border-b border-slate-100 dark:border-slate-800 space-y-3 flex-shrink-0">
            {/* Search */}
            <Input
              placeholder={viewMode === "mentor" ? "Search by mentor name" : "Search by participant name or phone number"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-sm shadow-none"
            />

            {/* Date range (mobile) */}
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRangePreset)}
              className="sm:hidden h-10 px-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 shadow-none w-full"
              aria-label="Date range"
            >
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All time</option>
            </select>

            {/* Mobile view mode toggle */}
            <div className="sm:hidden flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
              <button
                onClick={() => setViewMode("mentor")}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  viewMode === "mentor"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-400"
                }`}
              >
                By Mentor
              </button>
              <button
                onClick={() => setViewMode("participant")}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  viewMode === "participant"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-400"
                }`}
              >
                By Participant
              </button>
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 h-full overflow-y-auto min-h-0">
            {isLoadingList ? (
              <div className="p-4 space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="animate-pulse">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-slate-200 dark:bg-slate-700 rounded-full" />
                      <div className="flex-1">
                        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2" />
                        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="p-4 text-center">
                <p className="text-sm text-red-500">{error}</p>
                <Button size="sm" variant="outline" className="mt-2 cursor-pointer" onClick={fetchList}>
                  Retry
                </Button>
              </div>
            ) : viewMode === "mentor" ? (
              // Grouped by mentor
              <div>
                {mentorGroups.map((group) => {
                  const mentorKey = group.mentor?.id || "unassigned";
                  const isExpanded = expandedMentors.has(mentorKey);

                  return (
                    <div key={mentorKey} className="border-b border-slate-100 dark:border-slate-800">
                      <button
                        onClick={() => toggleMentor(mentorKey)}
                        className="w-full p-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-teal-100 dark:bg-teal-900/50 flex items-center justify-center">
                            <svg
                              className="w-4 h-4 text-teal-600 dark:text-teal-400"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                              />
                            </svg>
                          </div>
                          <div className="text-left">
                            <p className="font-semibold text-sm text-slate-900 dark:text-white">
                              {group.mentor?.name || group.mentor?.email || "Unassigned"}
                            </p>
                            <p className="text-xs text-slate-500">
                              {group.participants.length} participant{group.participants.length !== 1 ? "s" : ""} ·{" "}
                              {group.totalMessages} message{group.totalMessages !== 1 ? "s" : ""}
                            </p>
                          </div>
                        </div>
                        <svg
                          className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {isExpanded && (
                        <div className="bg-slate-50/50 dark:bg-slate-800/30">
                          {group.participants.length === 0 ? (
                            <p className="px-4 py-3 text-xs text-slate-400 italic">No participants assigned</p>
                          ) : (
                            group.participants.map((p) => renderParticipantItem(p))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Unassigned group */}
                {unassignedGroup && unassignedGroup.participants.length > 0 && (
                  <div className="border-b border-slate-100 dark:border-slate-800">
                    <button
                      onClick={() => toggleMentor("unassigned")}
                      className="w-full p-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                          <svg
                            className="w-4 h-4 text-slate-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                            />
                          </svg>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-sm text-slate-900 dark:text-white">Unassigned</p>
                          <p className="text-xs text-slate-500">
                            {unassignedGroup.participants.length} participant
                            {unassignedGroup.participants.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      <svg
                        className={`w-4 h-4 text-slate-400 transition-transform ${
                          expandedMentors.has("unassigned") ? "rotate-180" : ""
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {expandedMentors.has("unassigned") && (
                      <div className="bg-slate-50/50 dark:bg-slate-800/30">
                        {unassignedGroup.participants.map((p) => renderParticipantItem(p))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              // Flat participant list
              <div>
                {filteredParticipants.length === 0 ? (
                  <p className="p-4 text-sm text-slate-400 text-center">No conversations found</p>
                ) : (
                  filteredParticipants.map((p) => renderParticipantItem(p, true))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Message detail panel */}
        <div className={`flex-1 flex flex-col min-h-0 ${sidebarOpen ? "hidden md:flex" : "flex"}`}>
          {!selectedParticipantId ? (
            <div className="flex-1 flex items-center justify-center bg-slate-50/50 dark:bg-slate-800/30">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-slate-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                </div>
                <p className="text-slate-500 font-medium">Select a conversation</p>
                <p className="text-sm text-slate-400 mt-1">Choose a participant from the list to view messages</p>
              </div>
            </div>
          ) : isLoadingThread ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex items-center gap-2 text-slate-500">
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>Loading conversation...</span>
              </div>
            </div>
          ) : threadData ? (
            <>
              {/* Thread header */}
              <div className="p-4 border-b-2 border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* Mobile back button */}
                    <button
                      className="md:hidden p-2 -ml-2 text-slate-500 hover:text-slate-900 cursor-pointer"
                      onClick={() => setSidebarOpen(true)}
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <div className="w-10 h-10 rounded-full bg-teal-500 flex items-center justify-center text-white font-bold text-sm">
                      {getInitials(
                        threadData.participant.name,
                        threadData.participant.email,
                        threadData.participant.phone_number
                      )}
                    </div>
                    <div>
                      <p className="font-bold text-slate-900 dark:text-white">
                        {threadData.participant.name || "Unnamed"}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs text-slate-500">{formatPhone(threadData.participant.phone_number)}</p>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-200/70 text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                          Read-only · Use Mentor Inbox to send
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Stats */}
                    <div className="hidden sm:flex items-center gap-4 text-xs text-slate-500 mr-4">
                      <span>{threadData.stats.totalMessages} messages</span>
                      {threadData.stats.firstMessageDate && threadData.stats.lastMessageDate && (
                        <span>
                          {new Date(threadData.stats.firstMessageDate).toLocaleDateString()} -{" "}
                          {new Date(threadData.stats.lastMessageDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {/* Current mentor */}
                    {threadData.currentMentor && (
                      <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-teal-50 dark:bg-teal-900/30 rounded-lg">
                        <svg
                          className="w-4 h-4 text-teal-600 dark:text-teal-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                          />
                        </svg>
                        <span className="text-xs font-medium text-teal-700 dark:text-teal-300">
                          {threadData.currentMentor.name || threadData.currentMentor.email}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-6 min-h-0">
                {threadData.messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-slate-400 text-sm">No messages in this conversation</p>
                  </div>
                ) : (
                  groupedMessages.map((group, groupIndex) => (
                    <div key={groupIndex}>
                      {/* Date separator */}
                      <div className="flex items-center justify-center mb-4">
                        <span className="px-3 py-1 text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-full">
                          {group.date}
                        </span>
                      </div>

                      {/* Messages for this date */}
                      <div className="space-y-3">
                        {group.messages.map((message) => {
                          const status = getStatusDisplay(message.twilio_status);
                          return (
                            <div
                              key={message.id}
                              className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}
                            >
                              <div
                                className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                                  message.direction === "outbound"
                                    ? "bg-teal-500 text-white rounded-br-md"
                                    : "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-bl-md"
                                }`}
                              >
                                <p className="text-sm whitespace-pre-wrap break-words">{message.message_body}</p>
                                <div
                                  className={`flex items-center gap-2 mt-1 text-xs ${
                                    message.direction === "outbound" ? "text-teal-100" : "text-slate-400"
                                  }`}
                                >
                                  <span>
                                    {new Date(message.created_at).toLocaleTimeString("en-US", {
                                      hour: "numeric",
                                      minute: "2-digit",
                                      hour12: true,
                                    })}
                                  </span>
                                  {message.direction === "outbound" && status.icon && (
                                    <span className={status.color} title={status.label}>
                                      {status.icon}
                                    </span>
                                  )}
                                  {message.failure_reason && (
                                    <span
                                      className="text-red-300 cursor-help"
                                      title={message.failure_reason}
                                    >
                                      ⚠
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
