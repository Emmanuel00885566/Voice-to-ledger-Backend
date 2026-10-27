import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth";
import { serverError } from "@/lib/errors";

const CreateBusinessSchema = z.object({
  name: z.string().min(1, "Business name is required"),
  description: z.string().optional(),
  category: z.string().optional(),
  location: z.string().optional(),
  language: z.string().default("en"),
  currency: z.string().default("NGN"),
});

const UpdateBusinessSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().optional(),
  location: z.string().optional(),
  language: z.string().optional(),
  currency: z.string().optional(),
  description: z.string().optional(),
});

export async function POST(request: Request) {
  const { user, db, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user || !db) {
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

  // One business per user: the whole API assumes this, so refuse a second one
  const { data: existing, error: existingError } = await db
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1);

  if (existingError) {
    return serverError(existingError, "POST api/businesses (existing check)");
  }

  if (existing && existing.length > 0) {
    return Response.json({ error: "business_already_exists" }, { status: 409 });
  }

  const { data, error } = await db
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
    // Two requests at the same moment: the unique index lets only one through
    if (error.code === "23505") {
      return Response.json({ error: "business_already_exists" }, { status: 409 });
    }
    return serverError(error, "POST api/businesses");
  }

  return Response.json(data, { status: 201 });
}

export async function GET(request: Request) {
  const { user, db, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user || !db) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const { data, error } = await db
    .from("businesses")
    .select("*")
    .eq("owner_id", user.id);

  if (error) {
    return serverError(error, "GET api/businesses");
  }

  return Response.json(data);
}

export async function PATCH(request: Request) {
  const { user, db, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user || !db) {
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

  const { data, error } = await db
    .from("businesses")
    .update(updates)
    .eq("owner_id", user.id)
    .select()
    .maybeSingle();

  if (error) {
    return serverError(error, "PATCH api/businesses");
  }

  if (!data) {
    return Response.json({ error: "business_not_found" }, { status: 404 });
  }

  return Response.json(data);
}
