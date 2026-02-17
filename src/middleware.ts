
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          response = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Protected routes
  if (request.nextUrl.pathname.startsWith('/dashboard') && !user) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Redirect authenticated users from login page based on role
  if (request.nextUrl.pathname === '/' && user) {
    const userRole = user.user_metadata?.role || user.app_metadata?.role;
    
    // Participants should go to consent page (if invited) or stay on login
    if (userRole === 'participant') {
      return NextResponse.redirect(new URL('/invite/consent', request.url))
    }
    
    // Mentors/admins go to dashboard
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api/garmin/webhooks (Garmin push webhooks — no auth cookies)
     * - api/garmin/callback (OAuth callback — external redirect)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/garmin/webhooks|api/garmin/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
