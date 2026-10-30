import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "@/lib/auth";
import { serverError } from "@/lib/errors";
import { getPaidByTransaction, outstandingOf, round2 } from "@/lib/debts";

async function getUserBusinessId(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from("businesses")
    .select("id")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[api/dashboard getUserBusinessId]", error.message);
    return { businessId: null, error: "business_lookup_failed" };
  }
  if (!data) return { businessId: null, error: "business_not_found" };
  return { businessId: data.id, error: null };
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

  const { data: transactions, error } = await db
    .from("transactions")
    .select("id, type, amount")
    .eq("business_id", businessId);

  if (error) {
    return serverError(error, "GET api/dashboard");
  }

  const { paid, error: paidError } = await getPaidByTransaction(db, businessId);
  if (paidError || !paid) {
    return serverError(paidError ?? { message: "no payments" }, "GET api/dashboard (payments)");
  }

  const sum = (type: string) =>
    transactions
      .filter((t) => t.type === type)
      .reduce((total, t) => total + Number(t.amount), 0);

  // For debts, count only what is still owed (amount minus payments received or made)
  const owed = (type: string) =>
    round2(
      transactions
        .filter((t) => t.type === type)
        .reduce((total, t) => total + outstandingOf(t.amount, paid.get(t.id) ?? 0), 0)
    );

  const totalSales = sum("sale");
  const totalPurchases = sum("purchase");
  const totalExpenses = sum("expense");

  return Response.json({
    total_sales: totalSales,
    total_purchases: totalPurchases,
    total_expenses: totalExpenses,
    estimated_gross_profit: totalSales - totalPurchases,
    total_receivables: owed("receivable"),
    total_payables: owed("payable"),
  });
}