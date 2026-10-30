import type { SupabaseClient } from "@supabase/supabase-js";

// Money is rounded to 2 decimals so 0.1 + 0.2 style errors never show up in balances.
export const round2 = (n: number) => Math.round(n * 100) / 100;

// Total paid so far for each debt: transaction id -> amount paid.
export async function getPaidByTransaction(db: SupabaseClient, businessId: string) {
  const { data, error } = await db
    .from("debt_payments")
    .select("transaction_id, amount")
    .eq("business_id", businessId);

  if (error) return { paid: null, error };

  const paid = new Map<string, number>();
  for (const p of data ?? []) {
    paid.set(p.transaction_id, (paid.get(p.transaction_id) ?? 0) + Number(p.amount));
  }
  return { paid, error: null };
}

// What is still owed on one debt (never below zero).
export function outstandingOf(amount: number | string, paidSoFar: number) {
  return Math.max(0, round2(Number(amount) - paidSoFar));
}