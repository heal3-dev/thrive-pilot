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
      button { width: 100%; padding: 12px 16px; border: 0; border-radius: 12px; background: #0d9488; color: white; font-size: 16px; font-weight: 600; cursor: pointer; }
      button:hover { background: #0f766e; }
      .small { margin-top: 12px; font-size: 12px; color: #64748b; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Continue to Thrive Pilot</h1>
      <p>Tap continue to finish signing in and connect your Garmin.</p>
      <form method="post" action="${escapeHtml(action)}">
        ${hiddenInputs}
        <button type="submit">Continue</button>
      </form>
      <p class="small">If this link was opened by an email security scanner, it won’t complete sign-in until you tap Continue.</p>
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

  const supabase = await createClient()

  // PKCE flow: exchange authorization code for session
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('[AUTH_CALLBACK] Code exchange error:', error)
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
      return NextResponse.redirect(new URL('/?error=invalid_token', requestUrl.origin))
    }
    return NextResponse.redirect(new URL(next, requestUrl.origin))
  }

  console.error('[AUTH_CALLBACK] No code or token_hash provided (POST)')
  return NextResponse.redirect(new URL('/', requestUrl.origin))
}
