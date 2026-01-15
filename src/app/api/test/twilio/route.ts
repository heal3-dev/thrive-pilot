import { NextResponse } from "next/server";

export async function GET() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !phoneNumber) {
    return NextResponse.json(
      {
        error: "Missing Twilio credentials",
        accountSid: accountSid ? "✅ Loaded" : "❌ Missing",
        authToken: authToken ? "✅ Loaded" : "❌ Missing",
        phoneNumber: phoneNumber ? "✅ Loaded" : "❌ Missing",
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    message: "✅ All Twilio credentials loaded!",
    accountSid: `${accountSid.slice(0, 6)}...`,
    phoneNumber,
  });
}
