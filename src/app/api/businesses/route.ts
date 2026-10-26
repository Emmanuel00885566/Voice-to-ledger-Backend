import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { getAuthenticatedUser } from "@/lib/auth";

const CreateBusinessSchema = z.object({
  name: z.string().min(1, "Business name is required"),
  description: z.string().optional(),
  category: z.string().optional(),
  location: z.string().optional(),
  language: z.string().default("en"),
  currency: z.string().default("NGN"),
});

export async function POST(request: Request) {
  const { user, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const body = await request.json();
  const parsed = CreateBusinessSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "validation_failed", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("businesses")
    .insert({
  owner_id: user.id,
  name: parsed.data.name,
  description: parsed.data.description,
  category: parsed.data.category,
  location: parsed.data.location,
  language: parsed.data.language,
  currency: parsed.data.currency,
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
    .from("businesses")
    .select("*")
    .eq("owner_id", user.id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}
const UpdateBusinessSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().optional(),
  location: z.string().optional(),
  language: z.string().optional(),
  currency: z.string().optional(),
  description: z.string().optional(),
});

export async function PATCH(request: Request) {
  const { user, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const body = await request.json();
  const parsed = UpdateBusinessSchema.safeParse(body);

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

  const { data, error } = await supabase
    .from("businesses")
    .update(updates)
    .eq("owner_id", user.id)
    .select()
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return Response.json({ error: "business_not_found" }, { status: 404 });
  }

  return Response.json(data);
}