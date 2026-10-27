import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth";
import { serverError } from "@/lib/errors";
import { transactionDateSchema } from "@/lib/validation";

// Phone: digits with an optional leading +, spaces or dashes (e.g. 08012345678 or +234 801 234 5678)
const phoneSchema = z
  .string()
  .regex(/^\+?[0-9\s-]{7,20}$/, "Enter a valid phone number");

const CreateProfileSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required").max(100),
  phone: phoneSchema.optional(),
  gender: z.string().trim().min(1).max(30).optional(),
  // Reuses the "valid date, not in the future" rule
  date_of_birth: transactionDateSchema.optional(),
});

const UpdateProfileSchema = z.object({
  full_name: z.string().trim().min(1).max(100).optional(),
  phone: phoneSchema.optional(),
  gender: z.string().trim().min(1).max(30).optional(),
  date_of_birth: transactionDateSchema.optional(),
});

export async function GET(request: Request) {
  const { user, db, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user || !db) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return serverError(error, "GET api/profile");
  }

  if (!data) {
    return Response.json({ error: "profile_not_found" }, { status: 404 });
  }

  // Email comes from the login account, so it is included for the review screen
  return Response.json({ ...data, email: user.email });
}

export async function POST(request: Request) {
  const { user, db, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user || !db) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const body = await request.json();
  const parsed = CreateProfileSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "validation_failed", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // One profile per user
  const { data: existing, error: existingError } = await db
    .from("profiles")
    .select("id")
    .eq("user_id", user.id)
    .limit(1);

  if (existingError) {
    return serverError(existingError, "POST api/profile (existing check)");
  }

  if (existing && existing.length > 0) {
    return Response.json({ error: "profile_already_exists" }, { status: 409 });
  }

  const { data, error } = await db
    .from("profiles")
    .insert({
      user_id: user.id,
      ...parsed.data,
    })
    .select()
    .single();

  if (error) {
    // Two requests at the same moment: a unique index lets only one through
    if (error.code === "23505") {
      return Response.json({ error: "profile_already_exists" }, { status: 409 });
    }
    return serverError(error, "POST api/profile");
  }

  return Response.json({ ...data, email: user.email }, { status: 201 });
}

export async function PATCH(request: Request) {
  const { user, db, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user || !db) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const body = await request.json();
  const parsed = UpdateProfileSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "validation_failed", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // Only update fields that were actually sent
  const updates = Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined)
  );

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "no_fields_to_update" }, { status: 400 });
  }

  const { data, error } = await db
    .from("profiles")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .select()
    .maybeSingle();

  if (error) {
    return serverError(error, "PATCH api/profile");
  }

  if (!data) {
    return Response.json({ error: "profile_not_found" }, { status: 404 });
  }

  return Response.json({ ...data, email: user.email });
}