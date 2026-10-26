import { supabase } from "@/lib/supabase";
import { getAuthenticatedUser } from "@/lib/auth";

async function getUserBusinessId(userId: string) {
  const { data, error } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) return { businessId: null, error: error.message };
  if (!data) return { businessId: null, error: "business_not_found" };
  return { businessId: data.id, error: null };
}

export async function GET(request: Request) {
  const { user, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const { businessId, error: businessError } = await getUserBusinessId(user.id);
  if (businessError || !businessId) {
    return Response.json({ error: businessError ?? "business_not_found" }, { status: 404 });
  }

  const { data: transactions, error } = await supabase
    .from("transactions")
    .select("type, amount, transaction_date, payment_status")
    .eq("business_id", businessId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const sales = transactions.filter((t) => t.type === "sale");
  const purchases = transactions.filter((t) => t.type === "purchase");
  const expenses = transactions.filter((t) => t.type === "expense");
  const receivables = transactions.filter((t) => t.type === "receivable");
  const payables = transactions.filter((t) => t.type === "payable");

  const sum = (arr: typeof transactions) =>
    arr.reduce((total, t) => total + Number(t.amount), 0);

  const totalSales = sum(sales);
  const totalPurchases = sum(purchases);
  const totalExpenses = sum(expenses);
  const totalReceivables = sum(receivables);
  const totalPayables = sum(payables);

  const averageSaleValue = sales.length > 0 ? totalSales / sales.length : 0;

  const activeDays = new Set(transactions.map((t) => t.transaction_date)).size;

  const monthsWithSales = new Set(
    sales.map((t) => t.transaction_date.slice(0, 7)) // "YYYY-MM"
  ).size;
  const averageMonthlySales = monthsWithSales > 0 ? totalSales / monthsWithSales : 0;

  return Response.json({
    period: "entire_recorded_period",
    total_recorded_sales: totalSales,
    total_recorded_purchases: totalPurchases,
    total_recorded_expenses: totalExpenses,
    average_sale_value: averageSaleValue,
    average_monthly_sales: averageMonthlySales,
    estimated_gross_profit: totalSales - totalPurchases,
    outstanding_receivables: totalReceivables,
    outstanding_payables: totalPayables,
    transaction_count: transactions.length,
    active_recording_days: activeDays,
  });
}