import { supabase } from "@/lib/supabase";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  const { user, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (businessError || !business) {
    return Response.json(
      { error: "No business found for this user" },
      { status: 404 }
    );
  }

  // Bare-bones version for week 2 — no real transactions yet,
  // so everything returns zeroed. Week 3/4 will replace this
  // with real aggregation from the transactions table.
  return Response.json({
    total_sales: 0,
    total_purchases: 0,
    total_expenses: 0,
    estimated_gross_profit: 0,
    total_receivables: 0,
    total_payables: 0,
  });
}