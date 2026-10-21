import { supabase } from "@/lib/supabase";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  const { user, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user) {
    return Response.json({ error: authError }, { status: 401 });
  }

  // 1. Get this user's business
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id, name, currency")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (businessError) {
    return Response.json({ error: businessError.message }, { status: 500 });
  }

  if (!business) {
    return Response.json({ error: "business_not_found" }, { status: 404 });
  }

  // 2. Get all transactions for that business
  const { data: transactions, error: txError } = await supabase
    .from("transactions")
    .select("type, amount, payment_status, transaction_date")
    .eq("business_id", business.id);

  if (txError) {
    return Response.json({ error: txError.message }, { status: 500 });
  }

  const rows = transactions ?? [];

  // 3. Calculate totals
  let total_sales = 0;
  let total_purchases = 0;
  let total_expenses = 0;
  let total_receivables = 0;
  let total_payables = 0;

  for (const tx of rows) {
    const amount = Number(tx.amount) || 0;

    switch (tx.type) {
      case "sale":
        total_sales += amount;
        break;
      case "purchase":
        total_purchases += amount;
        break;
      case "expense":
        total_expenses += amount;
        break;
      case "receivable":
        total_receivables += amount;
        break;
      case "payable":
        total_payables += amount;
        break;
    }
  }

  // PRD: Estimated Gross Profit = Sales − Purchases
  const estimated_gross_profit = total_sales - total_purchases;

  // Optional: activity days (unique transaction dates)
  const activity_days = new Set(
    rows
      .map((tx) => tx.transaction_date)
      .filter(Boolean)
  ).size;

  return Response.json({
    business_id: business.id,
    business_name: business.name,
    currency: business.currency ?? "NGN",
    total_sales,
    total_purchases,
    total_expenses,
    estimated_gross_profit,
    total_receivables,
    total_payables,
    activity_days,
    transaction_count: rows.length,
    generated_at: new Date().toISOString(),
    note: "Basic Business Financial Profile — Not a Credit Score or Loan Guarantee",
  });
}