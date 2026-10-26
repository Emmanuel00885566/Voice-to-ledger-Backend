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
    .select("type, amount")
    .eq("business_id", businessId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const sum = (type: string) =>
    transactions
      .filter((t) => t.type === type)
      .reduce((total, t) => total + Number(t.amount), 0);

  const totalSales = sum("sale");
  const totalPurchases = sum("purchase");
  const totalExpenses = sum("expense");

  return Response.json({
    total_sales: totalSales,
    total_purchases: totalPurchases,
    total_expenses: totalExpenses,
    estimated_gross_profit: totalSales - totalPurchases,
    total_receivables: sum("receivable"),
    total_payables: sum("payable"),
  });
}