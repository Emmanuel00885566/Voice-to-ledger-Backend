import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createUserClient } from "@/lib/supabase-user";

type AuthResult =
  | { user: User; db: SupabaseClient; error: null }
  | { user: null; db: null; error: string };

export async function getAuthenticatedUser(request: Request): Promise<AuthResult> {
  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { user: null, db: null, error: "Missing or invalid authorization header" };
  }

  const token = authHeader.replace("Bearer ", "");

  // Client that acts as this user, so the database enforces RLS on every query
  const db = createUserClient(token);

  const { data, error } = await db.auth.getUser(token);

  if (error || !data.user) {
    return { user: null, db: null, error: "Invalid or expired token" };
  }

  return { user: data.user, db, error: null };
}
