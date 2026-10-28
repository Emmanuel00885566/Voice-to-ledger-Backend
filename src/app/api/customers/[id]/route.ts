import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "@/lib/auth";
import { serverError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";

const UpdateCustomerSchema = z.object({
  name: z.string().min(1).optional(),
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
    console.error("[api/customers/[id] getUserBusinessId]", error.message);
    return { businessId: null, error: "business_lookup_failed" };
  }
  if (!data) return { businessId: null, error: "business_not_found" };
  return { businessId: data.id, error: null };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { user, db, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user || !db) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json();
  const parsed = UpdateCustomerSchema.safeParse(body);

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

  const updates = Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined)
  );

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "no_fields_to_update" }, { status: 400 });
  }

    // Read the current row first so the audit log can keep the old values
  const { data: before, error: beforeError } = await db
    .from("customers")
    .select("*")
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle();

  if (beforeError) {
    return serverError(beforeError, "PATCH read before update");
  }

  if (!before) {
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const { data, error } = await db
    .from("customers")
    .update(updates)
    .eq("id", id)
    .eq("business_id", businessId)
    .select()
    .maybeSingle();

  if (error) {
    return serverError(error, "PATCH api/customers/[id]");
  }

  if (!data) {
    return Response.json({ error: "customer_not_found" }, { status: 404 });
  }
  await logAudit({
    db,
    userId: user.id,
    businessId,
    action: "update",
    entityType: "customer",
    entityId: id,
    oldValues: before,
    newValues: data,
  });

  return Response.json(data);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { user, db, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user || !db) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const { id } = await context.params;

  const { businessId, error: businessError } = await getUserBusinessId(db, user.id);
  if (businessError || !businessId) {
    return Response.json({ error: businessError ?? "business_not_found" }, { status: 404 });
  }

  const { data, error } = await db
    .from("customers")
    .delete()
    .eq("id", id)
    .eq("business_id", businessId)
    .select()
    .maybeSingle();

  if (error) {
    return serverError(error, "DELETE api/customers/[id]");
  }

  if (!data) {
    return Response.json({ error: "customer_not_found" }, { status: 404 });
  }

    await logAudit({
    db,
    userId: user.id,
    businessId,
    action: "delete",
    entityType: "customer",
    entityId: id,
    oldValues: data,
  });
  
  return Response.json({ success: true, deleted: data });
}
