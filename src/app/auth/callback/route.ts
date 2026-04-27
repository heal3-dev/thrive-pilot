import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderConfirmHtml(params: {
  origin: string
  next: string
  code?: string | null
  token_hash?: string | null
  type?: string | null
}) {
  const next = params.next || '/invite/consent'
  const isGarminConnect = next.startsWith('/garmin/connect')
  const action = `${params.origin}/auth/callback`
  const hiddenInputs = [
    params.code ? `<input type="hidden" name="code" value="${escapeHtml(params.code)}" />` : '',
    params.token_hash
      ? `<input type="hidden" name="token_hash" value="${escapeHtml(params.token_hash)}" />`
      : '',
    params.type ? `<input type="hidden" name="type" value="${escapeHtml(params.type)}" />` : '',
    `<input type="hidden" name="next" value="${escapeHtml(next)}" />`,
  ].join('\n')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Continue</title>
    <meta name="robots" content="noindex,nofollow" />
    <style>
      :root { color-scheme: light; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; }
      .card { max-width: 520px; margin: 0 auto; background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; box-shadow: 0 10px 30px rgba(2, 6, 23, 0.08); }
      h1 { font-size: 20px; margin: 0 0 8px; }
      p { margin: 0 0 16px; line-height: 1.5; color: #334155; }
      ul { margin: 0 0 16px; padding-left: 18px; color: #334155; }
      li { margin: 6px 0; }
      button { width: 100%; padding: 12px 16px; border: 0; border-radius: 12px; background: #0d9488; color: white; font-size: 16px; font-weight: 600; cursor: pointer; }
      button:hover { background: #0f766e; }
      .small { margin-top: 12px; font-size: 12px; color: #64748b; }
      .help { margin-top: 10px; font-size: 13px; color: #475569; }
      .help a { color: #0d9488; text-decoration: none; }
      .help a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${isGarminConnect ? 'Connect your Garmin' : 'Continue to Thrive Pilot'}</h1>
      <p>${isGarminConnect ? 'Tap Continue to securely sign in and connect your Garmin account.' : 'Tap Continue to securely finish signing in.'}</p>
      ${isGarminConnect ? `<ul>
        <li>If you’re on a phone, open this link in <strong>Chrome</strong> (Android) or <strong>Safari</strong> (iPhone).</li>
        <li>Avoid opening inside an email app “preview” browser when possible.</li>
      </ul>` : ''}
      <form method="post" action="${escapeHtml(action)}">
        ${hiddenInputs}
        <button type="submit">${isGarminConnect ? 'Continue to Garmin' : 'Continue'}</button>
      </form>
      <p class="small">Some email providers automatically preview links for safety. For security, your sign-in won’t complete until you tap Continue.</p>
      <p class="help">If you see an “Invalid or Expired Link” message after continuing, request a fresh connect email from your program administrator.</p>
    </main>
  </body>
</html>`
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const token_hash = requestUrl.searchParams.get('token_hash')
  const type = requestUrl.searchParams.get('type')
  const next = requestUrl.searchParams.get('next') || '/invite/consent'

  // Important: do NOT consume one-time tokens on GET. Some email providers and
  // security products prefetch links (GET) which can invalidate a magic link
  // before the participant actually taps it.
  if (code || (token_hash && type)) {
    const html = renderConfirmHtml({
      origin: requestUrl.origin,
      next,
      code,
      token_hash,
      type,
    })
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  }

  console.error('[AUTH_CALLBACK] No code or token_hash provided')
  return NextResponse.redirect(new URL('/', requestUrl.origin))
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url)
  const form = await request.formData()

  const code = (form.get('code') ?? '').toString() || null
  const token_hash = (form.get('token_hash') ?? '').toString() || null
  const type = (form.get('type') ?? '').toString() || null
  const next = (form.get('next') ?? '').toString() || '/invite/consent'
  const isGarminConnect = next.startsWith('/garmin/connect')

  const supabase = await createClient()

  // PKCE flow: exchange authorization code for session
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('[AUTH_CALLBACK] Code exchange error:', error)
      if (isGarminConnect) {
        return NextResponse.redirect(new URL('/garmin/error?reason=invalid_link', requestUrl.origin))
      }
      return NextResponse.redirect(new URL('/?error=auth_code_error', requestUrl.origin))
    }
    return NextResponse.redirect(new URL(next, requestUrl.origin))
  }

  // OTP/token hash flow (magic links, invites with token_hash)
  if (token_hash && type) {
    const otpType = type as EmailOtpType
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: otpType,
    })
    if (error) {
      console.error('[AUTH_CALLBACK] OTP verification error:', error)
      if (isGarminConnect) {
        return NextResponse.redirect(new URL('/garmin/error?reason=invalid_link', requestUrl.origin))
      }
      return NextResponse.redirect(new URL('/?error=invalid_token', requestUrl.origin))
    }
    return NextResponse.redirect(new URL(next, requestUrl.origin))
  }

  console.error('[AUTH_CALLBACK] No code or token_hash provided (POST)')
  return NextResponse.redirect(new URL('/', requestUrl.origin))
}
