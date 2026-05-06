"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { ParticipantMetricsTable } from "@/components/admin/ParticipantMetricsTable";
import type { Participant, SMSMessage } from "@/types";
import type { WeeklyFlag } from "@/lib/flags/rules";

type ParticipantWithAssignment = Participant & {
  assignment_id: string;
  unassigned_at: string | null;
};

type OptimisticSMSMessage = SMSMessage & {
  status?: "sending" | "error";
  error?: string;
};

type HealthMetric = {
  id: string;
  metric_date: string;
  resting_heart_rate: number | null;
  average_stress_level: number | null;
  sleep_duration_seconds: number | null;
  sleep_score: number | null;
  awake_seconds?: number | null;
  body_battery_charged: number | null;
  body_battery_drained: number | null;
  body_battery_start: number | null;
  body_battery_lowest: number | null;
  body_battery_most_recent: number | null;
  hrv_last_night_average: number | null;
  hrv_last_night_5_min_high: number | null;
};

/**
 * MentorInbox - Displays participant conversations for mentors
 */
export function MentorInbox({ enableHealthPanel = false }: { enableHealthPanel?: boolean }) {
  const MIN_HEALTH_PANEL_WIDTH = 300;
  const MIN_CHAT_PANEL_WIDTH = 420;
  const SIDEBAR_WIDTH = 288;
  const HEALTH_PANEL_WIDTH_STORAGE_KEY = "mentorInbox.healthPanelWidth";

  const [participants, setParticipants] = useState<ParticipantWithAssignment[]>([]);
  const [selectedParticipant, setSelectedParticipant] = useState<ParticipantWithAssignment | null>(null);
  const [messages, setMessages] = useState<OptimisticSMSMessage[]>([]);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [composerManualHeight, setComposerManualHeight] = useState<number | null>(null);
  const [isComposerResizing, setIsComposerResizing] = useState(false);
  const [isLoadingParticipants, setIsLoadingParticipants] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const lastSeenRef = useRef<Record<string, string>>({});
  const [showTemplates, setShowTemplates] = useState(false);
  const [showHealthPanel, setShowHealthPanel] = useState(false);
  const [healthPanelWidth, setHealthPanelWidth] = useState(380);
  const [isResizingHealthPanel, setIsResizingHealthPanel] = useState(false);
  const [healthMetrics, setHealthMetrics] = useState<HealthMetric[]>([]);
  const [healthWeeklyFlag, setHealthWeeklyFlag] = useState<WeeklyFlag | null>(null);
  const [isLoadingHealthMetrics, setIsLoadingHealthMetrics] = useState(false);
  const [healthMetricsError, setHealthMetricsError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const desktopLayoutRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerResizeStartRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // Message templates
  const messageTemplates = [
    {
      id: "away",
      label: "Away",
      message: "Thanks for reaching out. I'm not here right now, but I'll be back soon."
    }
  ];

  const totalUnread = useMemo(() => {
    return Object.values(unreadCounts).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
  }, [unreadCounts]);

  // Scroll to bottom of messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const clampComposerHeight = useCallback((h: number) => {
    return Math.min(Math.max(h, 40), 180);
  }, []);

  const lastSeenKey = useCallback((participantId: string) => `mentorInbox.lastSeen.${participantId}`, []);

  const getLastSeen = useCallback(
    (participantId: string): string | null => {
      if (typeof window === "undefined") return null;
      try {
        return window.localStorage.getItem(lastSeenKey(participantId));
      } catch {
        return null;
      }
    },
    [lastSeenKey],
  );

  const setLastSeen = useCallback(
    (participantId: string, iso: string) => {
      lastSeenRef.current[participantId] = iso;
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(lastSeenKey(participantId), iso);
      } catch {
        // ignore
      }
    },
    [lastSeenKey],
  );

  // Fetch assigned participants
  useEffect(() => {
    async function fetchParticipants() {
      setIsLoadingParticipants(true);
      setError(null);

      try {
        // Query mentor_assignments with joined participant data
        const { data, error: fetchError } = await supabase
          .from("mentor_assignments")
          .select(`
            id,
            participant_id,
            unassigned_at,
            participants (
              id,
              name,
              phone_number,
              email,
              is_active,
              created_at
            )
          `);

        if (fetchError) {
          setError("Failed to load participants");
          console.error("Fetch participants error:", fetchError);
          return;
        }

        // Transform data to flat structure
        type AssignmentRow = { id: string; participant_id: string; participants: unknown };
        const participantList: ParticipantWithAssignment[] = ((data || []) as unknown as AssignmentRow[])
          .map((assignment) => {
            if (!assignment.participants || typeof assignment.participants !== "object") return null;
            const participant = assignment.participants as Participant;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const unassignedAt = (assignment as any).unassigned_at;
            return { ...participant, assignment_id: assignment.id, unassigned_at: unassignedAt };
          })
          .filter((p): p is ParticipantWithAssignment => Boolean(p));

        setParticipants(participantList);

        // Initialize last-seen cache and unread counts from localStorage.
        const nextLastSeen: Record<string, string> = {};
        for (const p of participantList) {
          const v = getLastSeen(p.id);
          if (v) nextLastSeen[p.id] = v;
        }
        lastSeenRef.current = nextLastSeen;

        // Auto-select first participant if available
        if (participantList.length > 0 && !selectedParticipant) {
          setSelectedParticipant(participantList[0]);
        }
      } catch (err) {
        setError("Failed to load participants");
        console.error("Fetch participants error:", err);
      } finally {
        setIsLoadingParticipants(false);
      }
    }

    fetchParticipants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshUnreadCounts = useCallback(async () => {
    if (participants.length === 0) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

    try {
      const participantIds = participants.map((p) => p.id);
      if (participantIds.length === 0) return;

      // Choose a bounded query window so we don't pull the whole table.
      const lastSeenValues = Object.values(lastSeenRef.current);
      const since =
        lastSeenValues.length > 0
          ? new Date(Math.min(...lastSeenValues.map((v) => new Date(v).getTime()).filter((t) => Number.isFinite(t))))
          : new Date(Date.now() - 7 * 86_400_000);

      const { data, error } = await supabase
        .from("sms_messages")
        .select("participant_id, direction, created_at")
        .in("participant_id", participantIds)
        .eq("direction", "inbound")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) {
        // Don't surface in UI; it's only a best-effort badge.
        console.warn("refreshUnreadCounts failed:", error.message);
        return;
      }

      const selectedId = selectedParticipant?.id ?? null;
      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as Array<{ participant_id: string; created_at: string }>) {
        const pid = row.participant_id;
        if (!pid) continue;
        if (selectedId && pid === selectedId) continue; // viewing = read

        const seen = lastSeenRef.current[pid] ?? getLastSeen(pid) ?? null;
        if (seen && new Date(row.created_at).getTime() <= new Date(seen).getTime()) continue;
        counts[pid] = (counts[pid] ?? 0) + 1;
      }

      setUnreadCounts((prev) => ({ ...prev, ...counts }));
    } catch (e) {
      console.warn("refreshUnreadCounts error:", e);
    }
  }, [participants, selectedParticipant?.id, getLastSeen]);

  useEffect(() => {
    void refreshUnreadCounts();
  }, [refreshUnreadCounts]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshUnreadCounts();
    }, 30000);
    return () => clearInterval(interval);
  }, [refreshUnreadCounts]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void refreshUnreadCounts();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refreshUnreadCounts]);

  // Fetch messages when participant is selected
  // silent: true skips the loading state (used for background polling)
  const fetchMessages = useCallback(async (participantId: string, silent = false) => {
    if (!silent) setIsLoadingMessages(true);
    setSendError(null);
    setMessagesError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        setError("Authentication required");
        return;
      }

      const response = await fetch(`/api/sms/thread/${participantId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch messages");
      }

      const { messages: fetchedMessages } = await response.json();
      const sorted = [...(fetchedMessages || [])].sort((a: SMSMessage, b: SMSMessage) => {
        const at = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
        return at - bt;
      });
      setMessages(sorted);

      // Mark thread as seen (local-only) when it's explicitly fetched (selected).
      setUnreadCounts((prev) => {
        if (!prev[participantId]) return prev;
        const next = { ...prev };
        delete next[participantId];
        return next;
      });
      setLastSeen(participantId, new Date().toISOString());
    } catch (err) {
      console.error("Fetch messages error:", err);
      setMessages([]);
      setMessagesError(err instanceof Error ? err.message : "Failed to fetch messages");
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  const fetchHealthMetrics = useCallback(async (participantId: string) => {
    setIsLoadingHealthMetrics(true);
    setHealthMetricsError(null);
    setHealthMetrics([]);
    setHealthWeeklyFlag(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        throw new Error("Authentication required");
      }

      const response = await fetch(`/api/mentor/participants/${participantId}/metrics`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to load health trends");
      }

      const json = await response.json();
      setHealthMetrics((json.metrics as HealthMetric[]) ?? []);
      setHealthWeeklyFlag((json.weekly_flag as WeeklyFlag) ?? null);
    } catch (err) {
      setHealthMetrics([]);
      setHealthWeeklyFlag(null);
      setHealthMetricsError(err instanceof Error ? err.message : "Failed to load health trends");
    } finally {
      setIsLoadingHealthMetrics(false);
    }
  }, []);

  const clampHealthPanelWidth = useCallback((width: number) => {
    const containerWidth = desktopLayoutRef.current?.clientWidth ?? 1400;
    const maxHealthPanelWidth = Math.max(
      MIN_HEALTH_PANEL_WIDTH,
      containerWidth - SIDEBAR_WIDTH - MIN_CHAT_PANEL_WIDTH
    );

    return Math.min(Math.max(width, MIN_HEALTH_PANEL_WIDTH), maxHealthPanelWidth);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedWidth = window.localStorage.getItem(HEALTH_PANEL_WIDTH_STORAGE_KEY);
    if (!savedWidth) return;

    const parsed = Number(savedWidth);
    if (!Number.isFinite(parsed)) return;
    setHealthPanelWidth(clampHealthPanelWidth(parsed));
  }, [clampHealthPanelWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      HEALTH_PANEL_WIDTH_STORAGE_KEY,
      String(Math.round(healthPanelWidth))
    );
  }, [healthPanelWidth]);

  useEffect(() => {
    if (!isResizingHealthPanel) return;

    const handleMouseMove = (event: MouseEvent) => {
      const container = desktopLayoutRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const nextWidth = rect.right - event.clientX;
      setHealthPanelWidth(clampHealthPanelWidth(nextWidth));
    };

    const handleMouseUp = () => {
      setIsResizingHealthPanel(false);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingHealthPanel, clampHealthPanelWidth]);

  // Fetch messages when selected participant changes
  useEffect(() => {
    if (selectedParticipant) {
      fetchMessages(selectedParticipant.id);
    } else {
      setMessages([]);
    }
  }, [selectedParticipant, fetchMessages]);

  useEffect(() => {
    // Keep the composer height in sync with input content.
    const el = composerRef.current;
    if (!el) return;
    if (composerManualHeight != null) {
      el.style.height = `${clampComposerHeight(composerManualHeight)}px`;
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [messageInput, composerManualHeight, clampComposerHeight]);

  useEffect(() => {
    if (!isComposerResizing) return;

    const onMove = (event: PointerEvent) => {
      const start = composerResizeStartRef.current;
      if (!start) return;
      const delta = event.clientY - start.startY;
      const next = clampComposerHeight(start.startHeight + delta);
      setComposerManualHeight(next);
    };

    const onUp = () => {
      setIsComposerResizing(false);
      composerResizeStartRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isComposerResizing, clampComposerHeight]);

  useEffect(() => {
    if (!enableHealthPanel || !showHealthPanel || !selectedParticipant) return;
    fetchHealthMetrics(selectedParticipant.id);
  }, [enableHealthPanel, showHealthPanel, selectedParticipant, fetchHealthMetrics]);

  // Realtime updates for assigned participants
  // NOTE: Requires Realtime enabled on sms_messages table in Supabase Dashboard
  useEffect(() => {
    if (participants.length === 0) return;

    // Get participant IDs for filtering
    const participantIds = participants.map((p) => p.id);
    const participantFilter =
      participantIds.length > 0
        ? `participant_id=in.(${participantIds.map((id) => `"${id}"`).join(",")})`
        : undefined;

    // Create subscription with explicit filter for our participants
    // This is more reliable than relying purely on RLS for realtime
    const channel = supabase
      .channel("inbox-messages")
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sms_messages',
          ...(participantFilter ? { filter: participantFilter } : {}),
        },
        (payload) => {
          const newMessage = payload.new as SMSMessage;

          // Hide noisy Twilio auto-replies in the UI
          if (newMessage.message_type === "system_auto_reply") {
            return;
          }

          // If it's for the currently selected participant, append immediately (avoid refetch)
          if (newMessage.participant_id === selectedParticipant?.id) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMessage.id)) return prev;
              // Reconcile optimistic outbound message (temp id) with the real DB row.
              // This prevents a brief "double bubble" (optimistic + inserted) during sends.
              if (newMessage.direction === "outbound" && newMessage.twilio_sid) {
                const optimisticIdx = prev.findIndex(
                  (m) =>
                    String(m.id).startsWith("temp-") &&
                    m.direction === "outbound" &&
                    m.participant_id === newMessage.participant_id &&
                    m.message_body === newMessage.message_body
                );
                if (optimisticIdx !== -1) {
                  const next = [...prev];
                  next[optimisticIdx] = { ...newMessage, status: undefined };
                  return next.sort((a, b) => {
                    const at = a.created_at ? new Date(a.created_at).getTime() : 0;
                    const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
                    return at - bt;
                  });
                }
              }

              const next = [...prev, newMessage].sort((a, b) => {
                const at = a.created_at ? new Date(a.created_at).getTime() : 0;
                const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
                return at - bt;
              });
              return next;
            });
          } else if (newMessage.direction === "inbound") {
            // If the thread is open, treat as read; otherwise mark unread.
            if (newMessage.participant_id === selectedParticipant?.id) {
              setLastSeen(newMessage.participant_id, new Date().toISOString());
            } else {
              setUnreadCounts((prev) => ({
                ...prev,
                [newMessage.participant_id]: (prev[newMessage.participant_id] || 0) + 1,
              }));
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sms_messages",
          ...(participantFilter ? { filter: participantFilter } : {}),
        },
        (payload) => {
          // Status callbacks update existing rows (e.g. queued -> delivered)
          const updatedMessage = payload.new as SMSMessage;

          if (updatedMessage.message_type === "system_auto_reply") {
            return;
          }

          if (updatedMessage.participant_id === selectedParticipant?.id) {
            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === updatedMessage.id);
              if (idx === -1) return prev;
              const next = [...prev];
              next[idx] = { ...next[idx], ...updatedMessage };
              return next;
            });
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [participants, selectedParticipant, fetchMessages]);

  // Poll as a fallback (in case Realtime isn't enabled / deliverable for sms_messages)
  // Uses silent=true to avoid showing loading spinner during background refresh
  useEffect(() => {
    const id = selectedParticipant?.id;
    if (!id) return;
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchMessages(id, true); // silent poll - no loading spinner
    }, 15000);
    return () => clearInterval(interval);
  }, [selectedParticipant?.id, fetchMessages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Send message
  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedParticipant || isSending) return;

    const currentInput = messageInput.trim();
    const tempId = `temp-${Date.now()}`;
    const now = new Date().toISOString();

    // Create optimistic message
    const optimisticMsg: OptimisticSMSMessage = {
      id: tempId,
      participant_id: selectedParticipant.id,
      mentor_id: "", // Will be filled by server
      direction: "outbound",
      message_type: "mentor_message",
      message_body: currentInput,
      phone_number: selectedParticipant.phone_number,
      created_at: now,
      status: "sending",
    };

    // Update UI immediately
    setMessages((prev) => [...prev, optimisticMsg]);
    setMessageInput("");
    setSendError(null);
    setIsSending(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        throw new Error("Authentication required");
      }

      const response = await fetch("/api/sms/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          participantId: selectedParticipant.id,
          messageBody: currentInput,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({} as Record<string, unknown>));
        const base = (errorData as { error?: string }).error || "Failed to send message";
        const twilio = (errorData as { twilio?: { code?: string | number | null } }).twilio;
        const code = twilio?.code ? ` (Twilio code: ${twilio.code})` : "";
        throw new Error(base + code);
      }

      // Success - message will be updated via Realtime or next poll
      // However, we can replace the temp message with the actual one from response if provided
      const responseData = await response.json();
      if (responseData.message) {
        setMessages((prev) => {
          // If realtime inserted row already arrived, prefer it and just remove the temp.
          const alreadyHas = prev.some((m) => m.id === responseData.message.id);
          if (alreadyHas) {
            return prev.filter((m) => m.id !== tempId);
          }
          return prev.map((m) =>
            m.id === tempId ? { ...responseData.message, status: undefined } : m
          );
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to send message";
      setSendError(errorMsg);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...m, status: "error", error: errorMsg } : m
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  // Handle enter key to send
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Format timestamp for display (converts UTC to user's local timezone)
  const formatTime = (timestamp: string | undefined) => {
    if (!timestamp) return "";
    // If timestamp doesn't end with 'Z', append it to treat as UTC
    const utcTimestamp = timestamp.endsWith('Z') ? timestamp : timestamp + 'Z';
    const date = new Date(utcTimestamp);
    
    // Check if date is valid
    if (isNaN(date.getTime())) return "";
    
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) {
      // Today: show time only with AM/PM
      return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    } else if (isYesterday) {
      // Yesterday: show "Yesterday" + time
      return "Yesterday, " + date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    } else {
      // Older: show full date + time with year if different year
      const showYear = date.getFullYear() !== now.getFullYear();
      return date.toLocaleDateString("en-US", { 
        month: "short", 
        day: "numeric",
        ...(showYear ? { year: "numeric" } : {}),
        hour: "numeric", 
        minute: "2-digit",
        hour12: true 
      });
    }
  };

  // Format phone number for display
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

  // Get initials from name or fallback to email/phone
  const getInitials = (name: string | null | undefined, email: string | null | undefined, phone: string) => {
    if (name) {
      // Split by spaces
      const parts = name.trim().split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        // First letter of first and last name
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      } else if (parts.length === 1 && parts[0].length >= 1) {
        // Just first letter of single name
        return parts[0][0].toUpperCase();
      }
    }
    // Fallback to email username
    if (email) {
      const username = email.split("@")[0];
      const parts = username.split(/[-_.]+/).filter(Boolean);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      } else if (parts.length === 1 && parts[0].length >= 2) {
        return parts[0].slice(0, 2).toUpperCase();
      }
    }
    // Fallback to last 2 digits of phone
    return phone.replace(/\D/g, "").slice(-2);
  };

  // Loading state for participants
  if (isLoadingParticipants) {
    return (
      <div className="bg-white rounded-2xl border-2 border-slate-100 h-[600px] flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500">
          <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="font-medium">Loading participants...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-white rounded-2xl border-2 border-slate-100 h-full min-h-0 flex items-center justify-center overflow-hidden">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-red-50 flex items-center justify-center">
            <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-slate-900 font-semibold mb-1">Error loading inbox</p>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  // No participants state
  if (participants.length === 0) {
    return (
      <div className="bg-white rounded-2xl border-2 border-slate-100 h-full min-h-0 flex items-center justify-center overflow-hidden">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-slate-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-2">No participants assigned</h3>
          <p className="text-slate-500">You don&apos;t have any participants assigned yet. Contact your admin to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <>
    {/* Fill the available dashboard content height; scroll only inside panels. */}
    <div
      ref={desktopLayoutRef}
      className={`bg-white rounded-2xl border-2 border-slate-100 h-full min-h-0 flex flex-col md:flex-row overflow-hidden ${
        isResizingHealthPanel ? "cursor-col-resize" : ""
      }`}
    >
      {/* Sidebar - Participant List */}
      <div className="w-full md:w-72 md:border-r-2 border-slate-100 flex flex-col shrink-0 min-h-0">
        <div className="p-4 border-b-2 border-slate-100">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">Participants</h2>
              <p className="text-xs text-slate-500 mt-0.5">{participants.length} assigned</p>
            </div>
            <div className="text-xs font-semibold text-slate-600 whitespace-nowrap">
              Total new messages: {totalUnread}
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {participants.map((participant) => {
            const unreadCount = unreadCounts[participant.id] || 0;
            return (
              <button
                key={participant.id}
                onClick={() => {
                  setSelectedParticipant(participant);
                  // Clear unread count for this participant
                  setUnreadCounts(prev => {
                    const updated = { ...prev };
                    delete updated[participant.id];
                    return updated;
                  });
                }}
                className={`w-full p-4 text-left border-b border-slate-50 transition-colors cursor-pointer ${
                  selectedParticipant?.id === participant.id
                    ? "bg-teal-50 border-l-4 border-l-teal-500"
                    : "hover:bg-slate-50 border-l-4 border-l-transparent"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                      selectedParticipant?.id === participant.id ? "bg-teal-500" : "bg-slate-400"
                    }`}>
                      {getInitials(participant.name, participant.email, participant.phone_number)}
                    </div>
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-sm truncate ${unreadCount > 0 ? 'text-slate-900' : 'text-slate-900'}`}>
                      {participant.name || "Unnamed"}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {formatPhone(participant.phone_number)}
                    </p>
                    {(participant.unassigned_at || participant.is_active === false) && (
                      <span className="inline-flex mt-1 items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                        Unassigned
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Area - Message Thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedParticipant ? (
          <>
            {/* Header */}
            <div className="p-4 border-b-2 border-slate-100 bg-slate-50/50">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-teal-500 flex items-center justify-center text-white font-bold text-sm">
                    {getInitials(selectedParticipant.name, selectedParticipant.email, selectedParticipant.phone_number)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-900">{selectedParticipant.name || "Unnamed"}</p>
                      {(selectedParticipant.unassigned_at || selectedParticipant.is_active === false) && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-600">
                          Unassigned
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{formatPhone(selectedParticipant.phone_number)}</p>
                  </div>
                </div>
                {enableHealthPanel && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowHealthPanel((prev) => !prev)}
                    className="border-slate-300 text-slate-700 hover:bg-slate-100"
                  >
                    <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-4l-3 9L9 3l-3 9H2" />
                    </svg>
                    {showHealthPanel ? "Hide Health Trend" : "View Health Trend"}
                  </Button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messagesError ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center max-w-sm">
                    <p className="text-slate-900 font-semibold mb-1">Couldn&apos;t load messages</p>
                    <p className="text-sm text-slate-500">{messagesError}</p>
                  </div>
                </div>
              ) : isLoadingMessages ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex items-center gap-2 text-slate-500">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="text-sm">Loading messages...</span>
                  </div>
                </div>
              ) : messages
                  .filter((m) => m.message_type !== "system_auto_reply").length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-slate-100 flex items-center justify-center">
                      <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <p className="text-slate-500 text-sm">No messages yet</p>
                    <p className="text-slate-400 text-xs mt-1">Send a message to start the conversation</p>
                  </div>
                </div>
              ) : (
                <>
                  {messages
                    .filter((m) => m.message_type !== "system_auto_reply")
                    .map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2.5 relative ${
                          message.direction === "outbound"
                            ? `${message.status === "error" ? "bg-slate-300" : "bg-teal-500"} text-white rounded-br-md`
                            : "bg-slate-100 text-slate-900 rounded-bl-md"
                        } ${message.status === "sending" ? "opacity-70" : ""}`}
                      >
                        <p className="text-sm whitespace-pre-wrap break-words">{message.message_body}</p>
                        <div className="flex items-center justify-between gap-4 mt-1">
                          <p className={`text-xs ${
                            message.direction === "outbound" ? "text-teal-100" : "text-slate-400"
                          } ${message.status === "error" ? "text-slate-500" : ""}`}>
                            {formatTime(message.created_at)}
                          </p>
                          {message.status === "error" && (
                            <div className="flex items-center gap-1 text-[10px] font-bold text-red-500 bg-white/90 px-1.5 py-0.5 rounded shadow-sm">
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                              </svg>
                              <span title={message.error || "Something went wrong"}>
                                {message.error || "Something went wrong"}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Send Box */}
            <div className="p-4 border-t-2 border-slate-100 bg-white">
              {sendError && (
                <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200">
                  <p className="text-sm text-red-600 flex items-center gap-2">
                    <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    {sendError}
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-3">
                {/* Templates dropdown */}
                {showTemplates && (
                  <div className="bg-slate-50 rounded-lg border border-slate-200 p-2 space-y-1">
                    <div className="flex items-center justify-between px-2 py-1">
                      <span className="text-xs font-semibold text-slate-600 uppercase">Quick Templates</span>
                      <button
                        onClick={() => setShowTemplates(false)}
                        className="text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    {messageTemplates.map((template) => (
                      <button
                        key={template.id}
                        onClick={() => {
                          setMessageInput(template.message);
                          setShowTemplates(false);
                        }}
                        className="w-full text-left px-3 py-2 rounded-md hover:bg-white hover:shadow-sm transition-all text-sm cursor-pointer"
                      >
                        <div className="font-medium text-slate-700">{template.label}</div>
                        <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{template.message}</div>
                      </button>
                    ))}
                  </div>
                )}
                
                {/* Input and buttons */}
                <div className="flex gap-2 items-end">
                  <button
                    onClick={() => setShowTemplates(!showTemplates)}
                    className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 transition-colors flex items-center justify-center cursor-pointer"
                    title="Message templates"
                  >
                    <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </button>
                  <div className="flex-1 relative">
                    <textarea
                      ref={composerRef}
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={(selectedParticipant.unassigned_at || selectedParticipant.is_active === false) ? "Conversation is read-only" : "Type a message..."}
                      disabled={!!selectedParticipant.unassigned_at || selectedParticipant.is_active === false}
                      rows={1}
                      className="w-full min-h-[40px] max-h-[180px] rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-base font-medium shadow-sm transition-colors placeholder:text-slate-400 focus-visible:outline-none focus-visible:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50 overflow-y-auto"
                    />
                    {/* Center-top resize handle (drag to resize; double-click to reset to auto). */}
                    <button
                      type="button"
                      aria-label="Resize message composer"
                      title="Drag to resize (double-click to reset)"
                      onDoubleClick={() => setComposerManualHeight(null)}
                      onPointerDown={(e) => {
                        if (selectedParticipant.unassigned_at || selectedParticipant.is_active === false) return;
                        const el = composerRef.current;
                        if (!el) return;
                        composerResizeStartRef.current = {
                          startY: e.clientY,
                          startHeight: el.getBoundingClientRect().height,
                        };
                        setIsComposerResizing(true);
                        (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
                      }}
                      className="absolute -top-2 left-1/2 -translate-x-1/2 w-12 h-4 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center cursor-ns-resize hover:bg-slate-300"
                    >
                      <span className="block w-5 h-0.5 rounded bg-slate-500" />
                    </button>
                  </div>
                  <Button
                    onClick={handleSendMessage}
                    disabled={!messageInput.trim() || !!selectedParticipant.unassigned_at || selectedParticipant.is_active === false}
                    className="bg-teal-500 hover:bg-teal-600 text-white px-6 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    Send
                  </Button>
                </div>
                {(selectedParticipant.unassigned_at || selectedParticipant.is_active === false) && (
                   <p className="text-xs text-center text-slate-400 mt-2">
                     This conversation is read-only because the participant is unassigned.
                   </p>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-slate-50/50">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="text-slate-500 font-medium">Select a participant to view messages</p>
            </div>
          </div>
        )}
      </div>

      {enableHealthPanel && showHealthPanel && selectedParticipant && (
        <>
        <div
          className="hidden lg:block w-2 cursor-col-resize bg-slate-100 hover:bg-teal-200 active:bg-teal-300 transition-colors relative"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize health data panel"
          onMouseDown={(event) => {
            event.preventDefault();
            setIsResizingHealthPanel(true);
          }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-16 w-1 rounded-full bg-slate-300/80" />
        </div>
        <div
          className="hidden lg:flex border-l border-slate-100 bg-white flex-col min-h-0"
          style={{ width: `${healthPanelWidth}px` }}
        >
          <div className="px-4 py-3 border-b-2 border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-900">Health Data</h3>
              <p className="text-xs text-slate-500">Last 30 days for selected participant</p>
            </div>
            <button
              onClick={() => setShowHealthPanel(false)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
              aria-label="Close health trend panel"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {healthMetricsError ? (
              <div className="p-6 text-sm text-red-600">{healthMetricsError}</div>
            ) : (
              <ParticipantMetricsTable
                metrics={healthMetrics}
                weeklyFlag={healthWeeklyFlag}
                isLoading={isLoadingHealthMetrics}
                emptyMessage="No metrics found for this participant yet."
                className="h-full"
              />
            )}
          </div>
        </div>
        </>
      )}
    </div>

    {enableHealthPanel && showHealthPanel && selectedParticipant && (
      <div className="lg:hidden fixed inset-0 z-[60] bg-black/40">
        <div className="absolute inset-y-0 right-0 w-full sm:w-[90%] bg-white shadow-xl flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-900">Health Data</h3>
              <p className="text-xs text-slate-500">{selectedParticipant.name || "Participant"}</p>
            </div>
            <button
              onClick={() => setShowHealthPanel(false)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
              aria-label="Close health trend panel"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            {healthMetricsError ? (
              <div className="p-6 text-sm text-red-600">{healthMetricsError}</div>
            ) : (
              <ParticipantMetricsTable
                metrics={healthMetrics}
                weeklyFlag={healthWeeklyFlag}
                isLoading={isLoadingHealthMetrics}
                emptyMessage="No metrics found for this participant yet."
              />
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
