import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/_utils";
import { sendEmail } from "@/lib/email/send";
import { passwordRecoveryTemplate } from "@/lib/email/templates/password-recovery";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing mentor id" }, { status: 400 });

  const { data: mentor, error: mentorError } = await admin
    .from("mentors")
    .select("id, user_id, email, name, is_active")
    .eq("id", id)
    .maybeSingle();

  if (mentorError) {
    return NextResponse.json({ error: mentorError.message }, { status: 500 });
  }
  if (!mentor?.id) {
    return NextResponse.json({ error: "Mentor not found" }, { status: 404 });
  }
  if (!mentor.email) {
    return NextResponse.json({ error: "Mentor email is missing" }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    return NextResponse.json({ error: "Missing NEXT_PUBLIC_SITE_URL" }, { status: 500 });
  }

  // Generate a Supabase recovery link (same outcome as "Send password recovery" in Supabase UI)
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: mentor.email,
    options: {
      redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
    },
  });

  if (linkError || !linkData) {
    return NextResponse.json(
      { error: linkError?.message ?? "Failed to generate recovery link" },
      { status: 500 }
    );
  }

  const hashedToken = linkData.properties.hashed_token;
  if (!hashedToken) {
    return NextResponse.json({ error: "Recovery link token was not generated" }, { status: 500 });
  }

  // Route through our /auth/callback so we create a cookie session server-side.
  const nextPath = "/reset-password";
  const recoveryLink = `${siteUrl}/auth/callback?token_hash=${hashedToken}&type=recovery&next=${encodeURIComponent(
    nextPath
  )}`;

  try {
    await sendEmail({
      to: mentor.email,
      subject: "Reset your Thrive Pilot password",
      html: passwordRecoveryTemplate({
        name: mentor.name ?? undefined,
        link: recoveryLink,
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to send recovery email";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

