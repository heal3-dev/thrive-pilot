"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Participant, SMSMessage } from "@/types";

type ParticipantWithAssignment = Participant & {
  assignment_id: string;
};

/**
 * MentorInbox - Displays participant conversations for mentors
 */
export function MentorInbox() {
  const [participants, setParticipants] = useState<ParticipantWithAssignment[]>([]);
  const [selectedParticipant, setSelectedParticipant] = useState<ParticipantWithAssignment | null>(null);
  const [messages, setMessages] = useState<SMSMessage[]>([]);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [isLoadingParticipants, setIsLoadingParticipants] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [showTemplates, setShowTemplates] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<string | null>(null);

  // Message templates
  const messageTemplates = [
    {
      id: "checkin",
      label: "Weekly Check-in",
      message: "Hi! Just checking in to see how you're doing this week. How are things going?"
    },
    {
      id: "followup",
      label: "Follow-up",
      message: "Following up on our last conversation. Do you have any updates or questions I can help with?"
    },
    {
      id: "encouragement",
      label: "Encouragement",
      message: "You're doing great! Keep up the good work. I'm here if you need any support."
    },
    {
      id: "reminder",
      label: "Appointment Reminder",
      message: "Just a friendly reminder about our upcoming session. Looking forward to connecting with you!"
    },
    {
      id: "resources",
      label: "Share Resources",
      message: "I wanted to share some helpful resources with you. Let me know if you'd like to discuss any of them."
    }
  ];

  // Scroll to bottom of messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

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
        const participantList: ParticipantWithAssignment[] = (data || [])
          .filter((assignment) => assignment.participants)
          .map((assignment) => ({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...(assignment.participants as any),
            assignment_id: assignment.id,
          }));

        setParticipants(participantList);

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
    } catch (err) {
      console.error("Fetch messages error:", err);
      setMessages([]);
      setMessagesError(err instanceof Error ? err.message : "Failed to fetch messages");
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  // Fetch messages when selected participant changes
  useEffect(() => {
    if (selectedParticipant) {
      fetchMessages(selectedParticipant.id);
    } else {
      setMessages([]);
    }
  }, [selectedParticipant, fetchMessages]);

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

          // Hide noisy Twilio auto-replies in the UI (e.g. compliance responses like "OK")
          if (
            newMessage.message_type === "system_auto_reply" ||
            (newMessage.message_body?.trim().toUpperCase() === "OK" &&
              newMessage.message_type !== "mentor_message")
          ) {
            return;
          }

          // If it's for the currently selected participant, append immediately (avoid refetch)
          if (newMessage.participant_id === selectedParticipant?.id) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMessage.id)) return prev;
              const next = [...prev, newMessage].sort((a, b) => {
                const at = a.created_at ? new Date(a.created_at).getTime() : 0;
                const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
                return at - bt;
              });
              return next;
            });
          } else if (newMessage.direction === 'inbound') {
            // Only count inbound messages as unread
            setUnreadCounts(prev => ({
              ...prev,
              [newMessage.participant_id]: (prev[newMessage.participant_id] || 0) + 1
            }));
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

          if (
            updatedMessage.message_type === "system_auto_reply" ||
            (updatedMessage.message_body?.trim().toUpperCase() === "OK" &&
              updatedMessage.message_type !== "mentor_message")
          ) {
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
      .subscribe((status) => {
        setRealtimeStatus(status);
      });

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

    setIsSending(true);
    setSendError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        setSendError("Authentication required");
        return;
      }

      const response = await fetch("/api/sms/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          participantId: selectedParticipant.id,
          messageBody: messageInput.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to send message");
      }

      // Clear input and refresh messages
      setMessageInput("");
      await fetchMessages(selectedParticipant.id);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send message");
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
      <div className="bg-white rounded-2xl border-2 border-slate-100 h-[600px] flex items-center justify-center">
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
      <div className="bg-white rounded-2xl border-2 border-slate-100 h-[600px] flex items-center justify-center">
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
    <div className="bg-white rounded-2xl border-2 border-slate-100 h-[calc(100vh-14rem)] min-h-[520px] max-h-[760px] flex flex-col md:flex-row overflow-hidden">
      {/* Sidebar - Participant List */}
      <div className="w-full md:w-72 md:border-r-2 border-slate-100 flex flex-col shrink-0">
        <div className="p-4 border-b-2 border-slate-100">
          <h2 className="font-bold text-slate-900">Participants</h2>
          <p className="text-xs text-slate-500 mt-0.5">{participants.length} assigned</p>
        </div>
        <div className="flex-1 overflow-y-auto">
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
                className={`w-full p-4 text-left border-b border-slate-50 transition-colors ${
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
                    <p className="font-bold text-slate-900">{selectedParticipant.name || "Unnamed"}</p>
                    <p className="text-xs text-slate-500">{formatPhone(selectedParticipant.phone_number)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      realtimeStatus === "SUBSCRIBED" ? "bg-green-500" : "bg-slate-300"
                    }`}
                    aria-hidden="true"
                  />
                  <span>{realtimeStatus === "SUBSCRIBED" ? "Live" : "Syncing"}</span>
                </div>
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
                  .filter((m) => m.message_type !== "system_auto_reply")
                  .filter(
                    (m) =>
                      !(
                        m.message_body?.trim().toUpperCase() === "OK" &&
                        m.message_type !== "mentor_message"
                      )
                  ).length === 0 ? (
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
                    .filter(
                      (m) =>
                        !(
                          m.message_body?.trim().toUpperCase() === "OK" &&
                          m.message_type !== "mentor_message"
                        )
                    )
                    .map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                          message.direction === "outbound"
                            ? "bg-teal-500 text-white rounded-br-md"
                            : "bg-slate-100 text-slate-900 rounded-bl-md"
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap break-words">{message.message_body}</p>
                        <p className={`text-xs mt-1 ${
                          message.direction === "outbound" ? "text-teal-100" : "text-slate-400"
                        }`}>
                          {formatTime(message.created_at)}
                          {message.direction === "outbound" && message.twilio_status && (
                            <span className="ml-1 capitalize">• {message.twilio_status}</span>
                          )}
                        </p>
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
                        className="text-slate-400 hover:text-slate-600"
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
                        className="w-full text-left px-3 py-2 rounded-md hover:bg-white hover:shadow-sm transition-all text-sm"
                      >
                        <div className="font-medium text-slate-700">{template.label}</div>
                        <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{template.message}</div>
                      </button>
                    ))}
                  </div>
                )}
                
                {/* Input and buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowTemplates(!showTemplates)}
                    className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 transition-colors flex items-center justify-center"
                    title="Message templates"
                  >
                    <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </button>
                  <Input
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message..."
                    disabled={isSending}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={!messageInput.trim() || isSending}
                    className="bg-teal-500 hover:bg-teal-600 text-white px-6"
                  >
                    {isSending ? (
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                        Send
                      </>
                    )}
                  </Button>
                </div>
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
    </div>
  );
}
