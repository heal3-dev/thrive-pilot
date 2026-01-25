import { NextResponse } from "next/server";
import { requireMentor } from "../../_utils";

export async function GET(request: Request) {
  const guard = await requireMentor(request);
  if (!guard.ok) return guard.response;

  // The mentor record is already fetched by the guard for verification
  return NextResponse.json({
    mentor: guard.mentor,
    user: {
      id: guard.user.id,
      email: guard.user.email,
      last_sign_in_at: guard.user.last_sign_in_at,
    }
  });
}
