import { getAuthenticatedUser } from "@/lib/auth";
import { serverError } from "@/lib/errors";

type Row = {
  type: string | null;
  amount: number | string | null;
  transaction_date: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function GET(request: Request) {
  const { user, db, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user || !db) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const { data: business, error: bizError } = await db
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (bizError) return serverError(bizError, "activity.business");
  if (!business) {
    return Response.json({ error: "business_not_found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const monthsParam = Number(url.searchParams.get("months") ?? "6");
  const months = Number.isInteger(monthsParam) ? monthsParam : 6;
  if (months < 1 || months > 12) {
    return Response.json({ error: "invalid_months" }, { status: 400 });
  }

  // "Now" in Lagos (UTC+1)
  const lagosNow = new Date(Date.now() + 60 * 60 * 1000);
  const year = lagosNow.getUTCFullYear();
  const month = lagosNow.getUTCMonth(); // 0-11

  const buckets: { key: string; label: string; sales: number; costs: number }[] = [];
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.push({ key, label: names[d.getUTCMonth()], sales: 0, costs: 0 });
  }

  const from = `${buckets[0].key}-01`;

  const { data, error } = await db
    .from("transactions")
    .select("type,amount,transaction_date")
    .eq("business_id", business.id)
    .gte("transaction_date", from)
    .limit(10000);
  if (error) return serverError(error, "activity.transactions");

  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const r of (data ?? []) as Row[]) {
    const b = byKey.get((r.transaction_date ?? "").slice(0, 7));
    if (!b) continue;
    const amount = Number(r.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    if (r.type === "sale") b.sales += amount;
    else if (r.type === "purchase" || r.type === "expense") b.costs += amount;
  }

  return Response.json(
    {
      months: buckets.map((b) => ({
        month: b.key,
        label: b.label,
        sales: round2(b.sales),
        costs: round2(b.costs),
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}