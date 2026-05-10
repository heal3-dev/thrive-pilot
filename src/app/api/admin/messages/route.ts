import { NextResponse } from "next/server";

import { requireAdmin } from "../_utils";

/**
 * GET /api/admin/messages
 * Fetches all SMS conversations grouped by mentor, with participant and message info.
 * Used by the Admin Message Viewer (TICKET #16).
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;
  const url = new URL(request.url);
  
  // Optional query params for filtering
  const mentorId = url.searchParams.get("mentorId");
  const participantId = url.searchParams.get("participantId");
  const search = url.searchParams.get("search")?.trim().toLowerCase();
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const hasDateFilter = Boolean(dateFrom || dateTo);

  try {
    // Fetch all mentors (non-admin) for grouping
    const { data: mentors, error: mentorsError } = await admin
      .from("mentors")
      .select("id, name, email, is_active")
      .neq("role", "admin")
      .order("name", { ascending: true });

    if (mentorsError) {
      console.error("Error fetching mentors:", mentorsError);
      return NextResponse.json({ error: "Failed to fetch mentors" }, { status: 500 });
    }

    // Fetch all participants with their current assignment
    const { data: participants, error: participantsError } = await admin
      .from("participants")
      .select("id, name, phone_number, email, is_active")
      .order("name", { ascending: true });

    if (participantsError) {
      console.error("Error fetching participants:", participantsError);
      return NextResponse.json({ error: "Failed to fetch participants" }, { status: 500 });
    }

    // Fetch active assignments to map participants to mentors
    const { data: assignments, error: assignmentsError } = await admin
      .from("mentor_assignments")
      .select("id, mentor_id, participant_id, assigned_at, unassigned_at")
      .order("assigned_at", { ascending: false });

    if (assignmentsError) {
      console.error("Error fetching assignments:", assignmentsError);
      return NextResponse.json({ error: "Failed to fetch assignments" }, { status: 500 });
    }

    // Build participant -> current mentor map
    const participantMentorMap = new Map<string, string>();
    const activeAssignments = assignments?.filter(a => !a.unassigned_at) || [];
    for (const a of activeAssignments) {
      if (!participantMentorMap.has(a.participant_id)) {
        participantMentorMap.set(a.participant_id, a.mentor_id);
      }
    }

    // Build message query with filters
    let messageQuery = admin
      .from("sms_messages")
      .select("id, participant_id, mentor_id, direction, message_type, message_body, twilio_status, failure_reason, created_at")
      .neq("message_type", "system_auto_reply")
      .order("created_at", { ascending: false });

    if (mentorId) {
      messageQuery = messageQuery.eq("mentor_id", mentorId);
    }
    if (participantId) {
      messageQuery = messageQuery.eq("participant_id", participantId);
    }
    if (dateFrom) {
      messageQuery = messageQuery.gte("created_at", dateFrom);
    }
    if (dateTo) {
      // Treat dateTo as an exclusive upper bound (ISO timestamp).
      messageQuery = messageQuery.lt("created_at", dateTo);
    }

    const { data: messages, error: messagesError } = await messageQuery;

    if (messagesError) {
      console.error("Error fetching messages:", messagesError);
      return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
    }

    // Get last message and message count per participant
    const participantStats = new Map<string, { lastMessage: typeof messages[0] | null; messageCount: number }>();
    for (const msg of messages || []) {
      const stats = participantStats.get(msg.participant_id) || { lastMessage: null, messageCount: 0 };
      stats.messageCount++;
      if (!stats.lastMessage || new Date(msg.created_at!) > new Date(stats.lastMessage.created_at!)) {
        stats.lastMessage = msg;
      }
      participantStats.set(msg.participant_id, stats);
    }

    // Enrich participants with stats and mentor info
    const enrichedParticipants = (participants || []).map((p) => {
      const stats = participantStats.get(p.id);
      const currentMentorId = participantMentorMap.get(p.id);
      return {
        ...p,
        currentMentorId: currentMentorId || null,
        lastMessage: stats?.lastMessage || null,
        messageCount: stats?.messageCount || 0,
      };
    });

    // Build mentor name lookup for search
    const mentorNameMap = new Map(
      (mentors || []).map((m) => [m.id, (m.name?.toLowerCase() || "") + " " + (m.email?.toLowerCase() || "")])
    );

    // Apply search filter - check if search matches mentor OR participant
    let filteredParticipants = enrichedParticipants;
    if (search) {
      filteredParticipants = enrichedParticipants.filter((p) => {
        // Check if participant matches
        const participantMatch =
          p.name?.toLowerCase().includes(search) ||
          p.email?.toLowerCase().includes(search) ||
          p.phone_number?.includes(search);
        // Check if participant's mentor matches
        const mentorText = p.currentMentorId ? mentorNameMap.get(p.currentMentorId) || "" : "";
        const mentorMatch = mentorText.includes(search);
        return participantMatch || mentorMatch;
      });
    }

    // If date filtering is active, only keep threads with at least one message in the period.
    const threadsInPeriod = hasDateFilter
      ? filteredParticipants.filter((p) => (p.messageCount ?? 0) > 0)
      : filteredParticipants;

    // Group participants by mentor. Only include mentors with at least one participant thread.
    const mentorGroups = (mentors || [])
      .map((mentor) => {
        const mentorParticipants = threadsInPeriod.filter((p) => p.currentMentorId === mentor.id);
        return {
          mentor,
          participants: mentorParticipants,
          totalMessages: mentorParticipants.reduce((sum, p) => sum + (p.messageCount ?? 0), 0),
        };
      })
      .filter((g) => g.participants.length > 0);

    // Add unassigned participants group
    const unassignedParticipants = threadsInPeriod.filter((p) => !p.currentMentorId);
    const unassignedGroup =
      unassignedParticipants.length > 0
        ? {
            mentor: null,
            participants: unassignedParticipants,
            totalMessages: unassignedParticipants.reduce((sum, p) => sum + (p.messageCount ?? 0), 0),
          }
        : null;

    return NextResponse.json({
      mentorGroups,
      unassignedGroup,
      allParticipants: threadsInPeriod,
      allMentors: mentors || [],
    });
  } catch (err) {
    console.error("Error in admin messages API:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
