import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_ANON_KEY. Check .env.local and restart the dev server."
  );
}

// A Supabase client that acts AS the logged-in user.
// It uses the public (anon) key plus the user's own token, so Row-Level Security
// is enforced by the database on every query.
export function createUserClient(accessToken: string) {
  return createClient(supabaseUrl!, supabaseAnonKey!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}