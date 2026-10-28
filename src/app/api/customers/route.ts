import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "@/lib/auth";
import { serverError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";

const CreateCustomerSchema = z.object({
  name: z.string().min(1, "Customer name is required"),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
});

async function getUserBusinessId(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from("businesses")
    .select("id")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[api/customers getUserBusinessId]", error.message);
    return { businessId: null, error: "business_lookup_failed" };
  }
  if (!data) return { businessId: null, error: "business_not_found" };
  return { businessId: data.id, error: null };
}

export async function POST(request: Request) {
  const { user, db, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user || !db) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const body = await request.json();
  const parsed = CreateCustomerSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "validation_failed", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { businessId, error: businessError } = await getUserBusinessId(db, user.id);
  if (businessError || !businessId) {
    return Response.json({ error: businessError ?? "business_not_found" }, { status: 404 });
  }

  const { data, error } = await db
    .from("customers")
    .insert({
      business_id: businessId,
      ...parsed.data,
    })
    .select()
    .single();

  if (error) {
    return serverError(error, "api/customers");
  }
  await logAudit({
    db,
    userId: user.id,
    businessId,
    action: "create",
    entityType: "customer",
    entityId: data.id,
    newValues: data,
  });

  return Response.json(data, { status: 201 });
}

export async function GET(request: Request) {
  const { user, db, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user || !db) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const { businessId, error: businessError } = await getUserBusinessId(db, user.id);
  if (businessError || !businessId) {
    return Response.json({ error: businessError ?? "business_not_found" }, { status: 404 });
  }

  const { data, error } = await db
    .from("customers")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (error) {
    return serverError(error, "api/customers");
  }

  return Response.json(data);
}
