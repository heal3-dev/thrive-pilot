import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const token = requestUrl.searchParams.get('token')
  const type = requestUrl.searchParams.get('type')
  const redirectTo = requestUrl.searchParams.get('redirect_to') || '/invite/consent'

  if (token && type) {
    const supabase = await createClient()

    // Exchange the token for a session
    const { error } = await supabase.auth.verifyOtp({
      token_hash: token,
      type: type as any,
    })

    if (error) {
      console.error('[AUTH_CALLBACK] Error verifying token:', error)
      return NextResponse.redirect(new URL('/?error=invalid_token', requestUrl.origin))
    }

    // Successful verification - redirect to the intended page
    return NextResponse.redirect(new URL(redirectTo, requestUrl.origin))
  }

  // No token provided - redirect to home
  return NextResponse.redirect(new URL('/', requestUrl.origin))
}
