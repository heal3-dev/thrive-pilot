import { AuthError, Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * Auth response type for signUp and signIn operations
 */
export type AuthResponse = {
  user: User | null;
  session: Session | null;
  error: AuthError | null;
};

/**
 * Sign up a new user with email and password.
 *
 * @param email - User's email address
 * @param password - User's password (minimum 6 characters)
 * @returns AuthResponse with user, session, and potential error
 *
 * @example
 * const { user, session, error } = await signUp("user@example.com", "password123");
 * if (error) {
 *   console.error("Sign up failed:", error.message);
 * }
 */
export async function signUp(
  email: string,
  password: string
): Promise<AuthResponse> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  return {
    user: data.user,
    session: data.session,
    error,
  };
}

/**
 * Sign in an existing user with email and password.
 *
 * @param email - User's email address
 * @param password - User's password
 * @returns AuthResponse with user, session, and potential error
 *
 * @example
 * const { user, session, error } = await signIn("user@example.com", "password123");
 * if (error) {
 *   console.error("Sign in failed:", error.message);
 * }
 */
export async function signIn(
  email: string,
  password: string
): Promise<AuthResponse> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  return {
    user: data.user,
    session: data.session,
    error,
  };
}

/**
 * Sign out the current user.
 * Clears the session from local storage and invalidates the refresh token.
 *
 * @returns Error if sign out failed, null otherwise
 *
 * @example
 * const error = await signOut();
 * if (error) {
 *   console.error("Sign out failed:", error.message);
 * }
 */
export async function signOut(): Promise<AuthError | null> {
  const { error } = await supabase.auth.signOut();
  return error;
}

/**
 * Get the current session if one exists.
 * Returns null if the user is not authenticated.
 *
 * @returns Current session or null, plus any error
 *
 * @example
 * const { session, error } = await getSession();
 * if (session) {
 *   console.log("User is authenticated:", session.user.email);
 * }
 */
export async function getSession(): Promise<{
  session: Session | null;
  error: AuthError | null;
}> {
  const { data, error } = await supabase.auth.getSession();

  return {
    session: data.session,
    error,
  };
}

/**
 * Get the currently authenticated user.
 * Makes a request to the Supabase Auth server to validate the session.
 *
 * @returns Current user or null, plus any error
 *
 * @example
 * const { user, error } = await getCurrentUser();
 * if (user) {
 *   console.log("Logged in as:", user.email);
 * }
 */
export async function getCurrentUser(): Promise<{
  user: User | null;
  error: AuthError | null;
}> {
  const { data, error } = await supabase.auth.getUser();

  return {
    user: data.user,
    error,
  };
}
