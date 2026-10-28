import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "@/lib/auth";
import { serverError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { transactionDateSchema, positiveQuantity } from "@/lib/validation";

const CreateTransactionSchema = z.object({
  type: z.enum(["sale", "purchase", "expense", "receivable", "payable"]),
  description: z.string().optional(),
  product_name: z.string().optional(),
  quantity: positiveQuantity.optional(),
  unit: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().default("NGN"),
  transaction_date: transactionDateSchema.optional(),
  payment_status: z.enum(["paid", "unpaid", "partially_paid"]).default("paid"),
  input_method: z.enum(["voice", "manual"]),
  notes: z.string().optional(),
  allow_duplicate: z.boolean().optional(),
});

async function getUserBusinessId(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from("businesses")
    .select("id")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[api/transactions getUserBusinessId]", error.message);
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
  const parsed = CreateTransactionSchema.safeParse(body);

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

  // allow_duplicate is a control flag, not a column, so keep it out of the insert
  const { allow_duplicate, ...transactionData } = parsed.data;

  // Idempotency: if the app sends the same Idempotency-Key again (for example a
  // double-tapped confirm or a retry after a bad connection), return the original
  // transaction instead of saving a second one.
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || null;

  if (idempotencyKey) {
    const { data: replay, error: replayError } = await db
      .from("transactions")
      .select("*")
      .eq("business_id", businessId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (replayError) {
      return serverError(replayError, "api/transactions");
    }

    if (replay) {
      return Response.json(replay, {
        status: 200,
        headers: { "Idempotent-Replay": "true" },
      });
    }
  }

  // Duplicate detection: same type, amount and product within the last 60 seconds
  if (!allow_duplicate) {
    const since = new Date(Date.now() - 60_000).toISOString();

    let dupQuery = db
      .from("transactions")
      .select("*")
      .eq("business_id", businessId)
      .eq("type", transactionData.type)
      .eq("amount", transactionData.amount)
      .gte("created_at", since)
      .limit(1);

    dupQuery = transactionData.product_name
      ? dupQuery.eq("product_name", transactionData.product_name)
      : dupQuery.is("product_name", null);

    const { data: existing, error: dupError } = await dupQuery.maybeSingle();

    if (dupError) {
      return serverError(dupError, "api/transactions");
    }

    if (existing) {
      return Response.json({ error: "duplicate_transaction", existing }, { status: 409 });
    }
  }

  const { data, error } = await db
    .from("transactions")
    .insert({
      business_id: businessId,
      ...transactionData,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    })
    .select()
    .single();

  if (error) {
    // Two identical requests arrived at the same moment: the unique index let
    // only one through, so return the winner instead of an error.
    if (error.code === "23505" && idempotencyKey) {
      const { data: winner } = await db
        .from("transactions")
        .select("*")
        .eq("business_id", businessId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (winner) {
        return Response.json(winner, {
          status: 200,
          headers: { "Idempotent-Replay": "true" },
        });
      }
    }
    return serverError(error, "api/transactions");
  }

    await logAudit({
    db,
    userId: user.id,
    businessId,
    action: "create",
    entityType: "transaction",
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

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  let query = db
    .from("transactions")
    .select("*")
    .eq("business_id", businessId)
    .order("transaction_date", { ascending: false });

  if (type) {
    query = query.eq("type", type);
  }

  const { data, error } = await query;

  if (error) {
    return serverError(error, "api/transactions");
  }

  return Response.json(data);
}
