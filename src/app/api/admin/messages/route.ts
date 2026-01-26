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
      // Add end of day
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      messageQuery = messageQuery.lte("created_at", endDate.toISOString());
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
    let enrichedParticipants = (participants || []).map((p) => {
      const stats = participantStats.get(p.id);
      const currentMentorId = participantMentorMap.get(p.id);
      return {
        ...p,
        currentMentorId: currentMentorId || null,
        lastMessage: stats?.lastMessage || null,
        messageCount: stats?.messageCount || 0,
      };
    });

    // Apply search filter
    if (search) {
      const mentorNameMap = new Map((mentors || []).map(m => [m.id, m.name?.toLowerCase() || m.email?.toLowerCase() || ""]));
      enrichedParticipants = enrichedParticipants.filter((p) => {
        const participantMatch =
          p.name?.toLowerCase().includes(search) ||
          p.email?.toLowerCase().includes(search) ||
          p.phone_number?.includes(search);
        const mentorName = p.currentMentorId ? mentorNameMap.get(p.currentMentorId) : "";
        const mentorMatch = mentorName?.includes(search);
        return participantMatch || mentorMatch;
      });
    }

    // Group participants by mentor
    const mentorGroups = (mentors || []).map((mentor) => {
      const mentorParticipants = enrichedParticipants.filter((p) => p.currentMentorId === mentor.id);
      return {
        mentor,
        participants: mentorParticipants,
        totalMessages: mentorParticipants.reduce((sum, p) => sum + p.messageCount, 0),
      };
    });

    // Add unassigned participants group
    const unassignedParticipants = enrichedParticipants.filter((p) => !p.currentMentorId);
    const unassignedGroup = {
      mentor: null,
      participants: unassignedParticipants,
      totalMessages: unassignedParticipants.reduce((sum, p) => sum + p.messageCount, 0),
    };

    return NextResponse.json({
      mentorGroups,
      unassignedGroup,
      allParticipants: enrichedParticipants,
      allMentors: mentors || [],
    });
  } catch (err) {
    console.error("Error in admin messages API:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
