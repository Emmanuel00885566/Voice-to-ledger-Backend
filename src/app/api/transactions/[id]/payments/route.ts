import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "@/lib/auth";
import { serverError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { transactionDateSchema } from "@/lib/validation";
import { round2 } from "@/lib/debts";

const PaymentSchema = z.object({
  amount: z.number().positive(),
  paid_at: transactionDateSchema.optional(),
  note: z.string().max(200).optional(),
});

const idSchema = z.string().uuid();

async function getUserBusinessId(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from("businesses")
    .select("id")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[api/transactions/[id]/payments getUserBusinessId]", error.message);
    return { businessId: null, error: "business_lookup_failed" };
  }
  if (!data) return { businessId: null, error: "business_not_found" };
  return { businessId: data.id, error: null };
}

// Total already paid on one debt
async function sumPayments(db: SupabaseClient, businessId: string, transactionId: string) {
  const { data, error } = await db
    .from("debt_payments")
    .select("amount")
    .eq("business_id", businessId)
    .eq("transaction_id", transactionId);

  if (error) return { paid: 0, error };
  const paid = (data ?? []).reduce((total, p) => total + Number(p.amount), 0);
  return { paid: round2(paid), error: null };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { user, db, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user || !db) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return Response.json({ error: "invalid_id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = PaymentSchema.safeParse(body);
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

  const { data: debt, error: debtError } = await db
    .from("transactions")
    .select("id, type, amount")
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle();

  if (debtError) return serverError(debtError, "POST api/transactions/[id]/payments (read)");
  if (!debt) return Response.json({ error: "transaction_not_found" }, { status: 404 });

  if (debt.type !== "receivable" && debt.type !== "payable") {
    return Response.json({ error: "not_a_debt" }, { status: 400 });
  }

  const { paid: paidBefore, error: sumError } = await sumPayments(db, businessId, id);
  if (sumError) return serverError(sumError, "POST api/transactions/[id]/payments (sum)");

  const outstanding = round2(Number(debt.amount) - paidBefore);

  if (outstanding <= 0) {
    return Response.json({ error: "already_settled" }, { status: 409 });
  }
  if (parsed.data.amount > outstanding) {
    return Response.json({ error: "overpayment", outstanding }, { status: 409 });
  }

  const { data: payment, error: insertError } = await db
    .from("debt_payments")
    .insert({
      business_id: businessId,
      transaction_id: id,
      amount: parsed.data.amount,
      ...(parsed.data.paid_at ? { paid_at: parsed.data.paid_at } : {}),
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    })
    .select()
    .single();

  if (insertError) return serverError(insertError, "POST api/transactions/[id]/payments (insert)");

  const paidAfter = round2(paidBefore + parsed.data.amount);
  const amountLeft = round2(Number(debt.amount) - paidAfter);
  const paymentStatus = amountLeft <= 0 ? "paid" : "partially_paid";

  // Keep the debt's status in step with its payments
  const { error: statusError } = await db
    .from("transactions")
    .update({ payment_status: paymentStatus, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("business_id", businessId);

  if (statusError) {
    // The payment is already saved, so do not fail the request over the label
    console.error("[api/transactions/[id]/payments] status update failed:", statusError.message);
  }

  await logAudit({
    db,
    userId: user.id,
    businessId,
    action: "create",
    entityType: "debt_payment",
    entityId: payment.id,
    newValues: payment,
  });

  return Response.json(
    {
      payment,
      amount_paid: paidAfter,
      outstanding: Math.max(0, amountLeft),
      payment_status: paymentStatus,
    },
    { status: 201 }
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { user, db, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user || !db) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return Response.json({ error: "invalid_id" }, { status: 400 });
  }

  const { businessId, error: businessError } = await getUserBusinessId(db, user.id);
  if (businessError || !businessId) {
    return Response.json({ error: businessError ?? "business_not_found" }, { status: 404 });
  }

  const { data: debt, error: debtError } = await db
    .from("transactions")
    .select("id, type, amount, payment_status, due_date")
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle();

  if (debtError) return serverError(debtError, "GET api/transactions/[id]/payments (read)");
  if (!debt) return Response.json({ error: "transaction_not_found" }, { status: 404 });

  const { data: payments, error } = await db
    .from("debt_payments")
    .select("id, amount, paid_at, note, created_at")
    .eq("business_id", businessId)
    .eq("transaction_id", id)
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return serverError(error, "GET api/transactions/[id]/payments");

  const paid = round2((payments ?? []).reduce((total, p) => total + Number(p.amount), 0));

  return Response.json({
    transaction_id: id,
    type: debt.type,
    amount: Number(debt.amount),
    amount_paid: paid,
    outstanding: Math.max(0, round2(Number(debt.amount) - paid)),
    payment_status: debt.payment_status,
    due_date: debt.due_date,
    payments: payments ?? [],
  });
}