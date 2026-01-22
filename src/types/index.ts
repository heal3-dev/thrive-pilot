/**
 * Mentor - A user who provides guidance to participants
 * Maps to the `mentors` table in Supabase
 */
export interface Mentor {
  /** Primary key (UUID) */
  id: string;
  /** Foreign key to auth.users.id */
  user_id: string;
  /** Mentor's display name */
  name?: string | null;
  /** Mentor's email address */
  email?: string | null;
  /** Role for access control (e.g. 'admin') */
  role?: "admin" | "mentor" | string;
  /** Whether the mentor is currently active */
  is_active?: boolean;
  /** Timestamp when the mentor was created */
  created_at?: string;
  /** Timestamp when the mentor was last updated */
  updated_at?: string;
}

/**
 * Participant - A person receiving mentorship/support
 * Maps to the `participants` table in Supabase
 */
export interface Participant {
  /** Primary key (UUID) */
  id: string;
  /** Participant's name */
  name?: string | null;
  /** Participant's phone number for SMS communication */
  phone_number: string;
  /** Participant's email address */
  email?: string | null;
  /** Garmin user id (if connected) */
  garmin_user_id?: string | null;
  /** Whether the participant is currently active */
  is_active?: boolean;
  /** Consent flags (if used) */
  consent_given?: boolean;
  consent_timestamp?: string | null;
  /** Timestamp when the participant was created */
  created_at?: string;
  /** Timestamp when the participant was last updated */
  updated_at?: string;
}

/**
 * SMS message direction
 */
export type SMSDirection = "inbound" | "outbound";

/**
 * SMS message type
 */
export type SMSMessageType =
  | "user_message"
  | "user_command"
  | "system_auto_reply"
  | "mentor_message"
  | "notification"
  | "reminder";

/**
 * Twilio message status values
 */
export type TwilioStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed"
  | "received";

/**
 * SMSMessage - A single SMS message in a conversation
 * Maps to the `sms_messages` table in Supabase
 */
export interface SMSMessage {
  /** Primary key (UUID) */
  id: string;
  /** Foreign key to participants.id */
  participant_id: string;
  /** Foreign key to mentors.id */
  mentor_id: string;
  /** Direction of the message (inbound from participant, outbound to participant) */
  direction: SMSDirection;
  /** Type of message */
  message_type: SMSMessageType;
  /** The content of the SMS message */
  message_body: string;
  /** Phone number associated with the message */
  phone_number: string;
  /** Twilio message SID for tracking */
  twilio_sid?: string | null;
  /** Current Twilio delivery status */
  twilio_status?: TwilioStatus | null;
  /** Read/unread marker */
  is_read?: boolean;
  /** Delivery timestamps (optional) */
  sent_at?: string | null;
  delivered_at?: string | null;
  failed_at?: string | null;
  failure_reason?: string | null;
  /** Timestamp when the message was created */
  created_at?: string;
  /** Timestamp when the message was last updated */
  updated_at?: string;
}

/**
 * MentorAssignment - Links mentors to their assigned participants
 * Maps to the `mentor_assignments` table in Supabase
 */
export interface MentorAssignment {
  /** Primary key (UUID) */
  id: string;
  /** Foreign key to mentors.id */
  mentor_id: string;
  /** Foreign key to participants.id */
  participant_id: string;
  /** Timestamp when the assignment was created */
  assigned_at?: string;
  /** Timestamp when the assignment was ended (null = active) */
  unassigned_at?: string | null;
}

/**
 * Utility type for creating new records (omits auto-generated fields)
 */
export type NewMentor = Omit<Mentor, "id" | "created_at" | "updated_at">;
export type NewParticipant = Omit<
  Participant,
  "id" | "created_at" | "updated_at"
>;
export type NewSMSMessage = Omit<SMSMessage, "id" | "created_at" | "updated_at">;
export type NewMentorAssignment = Omit<
  MentorAssignment,
  "id" | "created_at" | "updated_at"
>;

/**
 * Utility type for updating existing records (all fields optional except id)
 */
export type UpdateMentor = Partial<Omit<Mentor, "id">> & { id: string };
export type UpdateParticipant = Partial<Omit<Participant, "id">> & {
  id: string;
};
export type UpdateSMSMessage = Partial<Omit<SMSMessage, "id">> & { id: string };
export type UpdateMentorAssignment = Partial<Omit<MentorAssignment, "id">> & {
  id: string;
};
