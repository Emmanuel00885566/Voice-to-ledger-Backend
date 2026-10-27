import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "@/lib/auth";
import { serverError } from "@/lib/errors";
import { transactionDateSchema, positiveQuantity } from "@/lib/validation";

const UpdateTransactionSchema = z.object({
  type: z.enum(["sale", "purchase", "expense", "receivable", "payable"]).optional(),
  description: z.string().optional(),
  product_name: z.string().optional(),
  quantity: positiveQuantity.optional(),
  unit: z.string().optional(),
  amount: z.number().positive().optional(),
  currency: z.string().optional(),
  transaction_date: transactionDateSchema.optional(),
  payment_status: z.enum(["paid", "unpaid", "partially_paid"]).optional(),
  notes: z.string().optional(),
});

async function getUserBusinessId(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from("businesses")
    .select("id")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[api/transactions/[id] getUserBusinessId]", error.message);
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
  const parsed = UpdateTransactionSchema.safeParse(body);

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

  const { data, error } = await db
    .from("transactions")
    .update(updates)
    .eq("id", id)
    .eq("business_id", businessId)
    .select()
    .maybeSingle();

  if (error) {
    return serverError(error, "api/transactions/[id]");
  }

  if (!data) {
    return Response.json({ error: "transaction_not_found" }, { status: 404 });
  }

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
    .from("transactions")
    .delete()
    .eq("id", id)
    .eq("business_id", businessId)
    .select()
    .maybeSingle();

  if (error) {
    return serverError(error, "api/transactions/[id]");
  }

  if (!data) {
    return Response.json({ error: "transaction_not_found" }, { status: 404 });
  }

  return Response.json({ success: true, deleted: data });
}
