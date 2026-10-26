import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { getAuthenticatedUser } from "@/lib/auth";

const CreateProfileSchema = z.object({
  full_name: z.string().min(1, "Full name is required"),
  phone: z.string().optional(),
  gender: z.string().optional(),
  date_of_birth: z.string().optional(),
});

const UpdateProfileSchema = z.object({
  full_name: z.string().min(1).optional(),
  phone: z.string().optional(),
  gender: z.string().optional(),
  date_of_birth: z.string().optional(),
});

export async function POST(request: Request) {
  const { user, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user) {
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

  const { data, error } = await supabase
    .from("profiles")
    .insert({
      user_id: user.id,
      ...parsed.data,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data, { status: 201 });
}

export async function GET(request: Request) {
  const { user, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return Response.json({ error: "profile_not_found" }, { status: 404 });
  }

  return Response.json(data);
}

export async function PATCH(request: Request) {
  const { user, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user) {
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

  const updates = Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined)
  );

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "no_fields_to_update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("user_id", user.id)
    .select()
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return Response.json({ error: "profile_not_found" }, { status: 404 });
  }

  return Response.json(data);
}