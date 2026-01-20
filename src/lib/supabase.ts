import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Supabase client for frontend/browser usage.
 * Uses the anon key which respects Row Level Security (RLS) policies.
 * Safe to use in client components.
 */
function createSupabaseClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables. Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set."
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Supabase admin client for server-side/API route usage.
 * Uses the service role key which bypasses Row Level Security (RLS).
 * NEVER expose this client to the browser - server-side only!
 */
function createSupabaseAdmin(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("supabaseAdmin can only be used on the server.");
  }

  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Missing Supabase admin environment variables. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set."
    );
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Creates a Supabase client scoped to a specific user's session.
 * Useful for API routes that need to respect RLS for the authenticated user.
 *
 * @param accessToken - The user's JWT access token from Supabase Auth
 * @returns A Supabase client that operates under the user's RLS context
 */
export function createSupabaseClientWithAuth(
  accessToken: string
): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables. Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set."
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

// Export singleton instance (browser-safe)
export const supabase = createSupabaseClient();

/**
 * Server-only singleton accessor for the service role client.
 *
 * IMPORTANT:
 * - Do NOT import/call this from client components.
 * - Requires SUPABASE_SERVICE_ROLE_KEY (non-public env var).
 */
let _supabaseAdmin: SupabaseClient | null = null;
export function getSupabaseAdmin(): SupabaseClient {
  if (_supabaseAdmin) return _supabaseAdmin;
  _supabaseAdmin = createSupabaseAdmin();
  return _supabaseAdmin;
}
