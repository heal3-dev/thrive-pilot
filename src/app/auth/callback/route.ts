import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const token_hash = requestUrl.searchParams.get('token_hash')
  const type = requestUrl.searchParams.get('type')
  const next = requestUrl.searchParams.get('next') || '/invite/consent'

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
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as any,
    })
    if (error) {
      console.error('[AUTH_CALLBACK] OTP verification error:', error)
      return NextResponse.redirect(new URL('/?error=invalid_token', requestUrl.origin))
    }
    return NextResponse.redirect(new URL(next, requestUrl.origin))
  }

  console.error('[AUTH_CALLBACK] No code or token_hash provided')
  return NextResponse.redirect(new URL('/', requestUrl.origin))
}
