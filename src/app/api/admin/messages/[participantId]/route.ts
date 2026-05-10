import { NextResponse } from "next/server";

import { requireAdmin } from "../../_utils";

type RouteParams = {
  params: Promise<{ participantId: string }>;
};

/**
 * GET /api/admin/messages/[participantId]
 * Fetches all messages for a specific participant along with participant and mentor details.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;
  const url = new URL(request.url);
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const { participantId } = await params;

  if (!participantId) {
    return NextResponse.json({ error: "Participant ID required" }, { status: 400 });
  }

  try {
    // Fetch participant details
    const { data: participant, error: participantError } = await admin
      .from("participants")
      .select("id, name, phone_number, email, is_active, created_at")
      .eq("id", participantId)
      .single();

    if (participantError || !participant) {
      return NextResponse.json({ error: "Participant not found" }, { status: 404 });
    }

    // Fetch current assignment
    const { data: currentAssignment, error: assignmentError } = await admin
      .from("mentor_assignments")
      .select(`
        id,
        mentor_id,
        assigned_at,
        mentors ( id, name, email )
      `)
      .eq("participant_id", participantId)
      .is("unassigned_at", null)
      .maybeSingle();

    if (assignmentError) {
      console.error("Error fetching assignment:", assignmentError);
    }

    // Fetch assignment history
    const { data: assignmentHistory, error: historyError } = await admin
      .from("mentor_assignments")
      .select(`
        id,
        mentor_id,
        assigned_at,
        unassigned_at,
        mentors ( id, name, email )
      `)
      .eq("participant_id", participantId)
      .order("assigned_at", { ascending: false });

    if (historyError) {
      console.error("Error fetching assignment history:", historyError);
    }

    // Fetch all messages for this participant
    let messagesQuery = admin
      .from("sms_messages")
      .select(
        "id, participant_id, mentor_id, direction, message_type, message_body, phone_number, twilio_status, failure_reason, created_at"
      )
      .eq("participant_id", participantId)
      .order("created_at", { ascending: true });

    if (dateFrom) {
      messagesQuery = messagesQuery.gte("created_at", dateFrom);
    }
    if (dateTo) {
      // Treat dateTo as an exclusive upper bound (ISO timestamp).
      messagesQuery = messagesQuery.lt("created_at", dateTo);
    }

    const { data: messages, error: messagesError } = await messagesQuery;

    if (messagesError) {
      console.error("Error fetching messages:", messagesError);
      return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
    }

    // Get unique mentor IDs from messages to fetch mentor names
    const mentorIds = [...new Set((messages || []).map(m => m.mentor_id).filter(Boolean))];
    let mentorMap: Record<string, { id: string; name: string | null; email: string | null }> = {};

    if (mentorIds.length > 0) {
      const { data: mentors } = await admin
        .from("mentors")
        .select("id, name, email")
        .in("id", mentorIds);

      if (mentors) {
        mentorMap = Object.fromEntries(mentors.map(m => [m.id, m]));
      }
    }

    // Enrich messages with mentor info
    const enrichedMessages = (messages || []).map((msg) => ({
      ...msg,
      mentor: msg.mentor_id ? mentorMap[msg.mentor_id] || null : null,
    }));

    // Calculate stats
    const stats = {
      totalMessages: enrichedMessages.length,
      inboundCount: enrichedMessages.filter(m => m.direction === "inbound").length,
      outboundCount: enrichedMessages.filter(m => m.direction === "outbound").length,
      firstMessageDate: enrichedMessages[0]?.created_at || null,
      lastMessageDate: enrichedMessages[enrichedMessages.length - 1]?.created_at || null,
    };

    return NextResponse.json({
      participant,
      currentMentor: currentAssignment
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? { ...(currentAssignment.mentors as any), assignedAt: currentAssignment.assigned_at }
        : null,
      assignmentHistory: (assignmentHistory || []).map((a) => ({
        id: a.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mentor: a.mentors as any,
        assignedAt: a.assigned_at,
        unassignedAt: a.unassigned_at,
      })),
      messages: enrichedMessages,
      stats,
    });
  } catch (err) {
    console.error("Error in admin messages participant API:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
