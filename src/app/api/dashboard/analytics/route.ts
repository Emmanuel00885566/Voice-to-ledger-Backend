import { getAuthenticatedUser } from "@/lib/auth";
import { serverError } from "@/lib/errors";
import { rateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { getPaidByTransaction, outstandingOf } from "@/lib/debts";

type Row = {
  id: string;
  type: string | null;
  amount: number | string | null;
  payment_status: string | null;
  transaction_date: string | null;
};

type Acc = {
  sales: number;
  purchases: number;
  expenses: number;
  receivables: number;
  payables: number;
  saleCount: number;
};

const RANGES: Record<string, number> = { "3m": 3, "6m": 6, "12m": 12 };
const NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function emptyAcc(): Acc {
  return { sales: 0, purchases: 0, expenses: 0, receivables: 0, payables: 0, saleCount: 0 };
}
function change(cur: number, prev: number): number | null {
  return prev > 0 ? round1(((cur - prev) / prev) * 100) : null;
}

function accumulate(
  acc: Acc,
  type: string | null,
  amount: number,
  status: string | null,
  remaining: number
) {
  switch (type) {
    case "sale":
      acc.sales += amount;
      acc.saleCount += 1;
      break;
    case "purchase":
      acc.purchases += amount;
      break;
    case "expense":
      acc.expenses += amount;
      break;
    case "receivable":
      if (status !== "paid") acc.receivables += remaining;
      break;
    case "payable":
      if (status !== "paid") acc.payables += remaining;
      break;
    default:
      break;
  }
}

export async function GET(request: Request) {
  const { user, db, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user || !db) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const limited = rateLimit("analytics", user.id, 30, 60_000);
  if (!limited.allowed) return rateLimitedResponse(limited.retryAfterSeconds);

  const url = new URL(request.url);
  const rangeKey = url.searchParams.get("range") ?? "3m";
  const n = RANGES[rangeKey];
  if (!n) return Response.json({ error: "invalid_range" }, { status: 400 });

  const { data: business, error: bizError } = await db
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (bizError) return serverError(bizError, "analytics.business");
  if (!business) return Response.json({ error: "business_not_found" }, { status: 404 });

  // "Now" in Lagos (UTC+1)
  const lagosNow = new Date(Date.now() + 60 * 60 * 1000);
  const y = lagosNow.getUTCFullYear();
  const m = lagosNow.getUTCMonth();
  const startOf = (monthsBack: number) => new Date(Date.UTC(y, m - monthsBack, 1));
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  const startStr = ymd(startOf(n - 1));
  const prevStartStr = ymd(startOf(2 * n - 1));

  const buckets = [] as { key: string; label: string; sales: number; purchases: number; expenses: number }[];
  for (let i = n - 1; i >= 0; i--) {
    const d = startOf(i);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.push({ key, label: NAMES[d.getUTCMonth()], sales: 0, purchases: 0, expenses: 0 });
  }
  const byMonth = new Map(buckets.map((b) => [b.key, b]));

  const { data, error } = await db
    .from("transactions")
    .select("id,type,amount,payment_status,transaction_date")
    .eq("business_id", business.id)
    .gte("transaction_date", prevStartStr)
    .limit(10000);
  if (error) return serverError(error, "analytics.transactions");

  const { paid, error: paidError } = await getPaidByTransaction(db, business.id);
  if (paidError || !paid) return serverError(paidError, "analytics.payments");

  const cur = emptyAcc();
  const prev = emptyAcc();
  const typeStats = {
    sale: { count: 0, amount: 0 },
    purchase: { count: 0, amount: 0 },
    expense: { count: 0, amount: 0 },
  };

  for (const r of (data ?? []) as Row[]) {
    const amount = Number(r.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    const date = r.transaction_date ?? "";
    const remaining = outstandingOf(amount, paid.get(r.id) ?? 0);

    if (date >= startStr) {
      accumulate(cur, r.type, amount, r.payment_status, remaining);
      const b = byMonth.get(date.slice(0, 7));
      if (b) {
        if (r.type === "sale") b.sales += amount;
        if (r.type === "purchase") b.purchases += amount;
        if (r.type === "expense") b.expenses += amount;
      }
      if (r.type === "sale" || r.type === "purchase" || r.type === "expense") {
        typeStats[r.type].count += 1;
        typeStats[r.type].amount += amount;
      }
    } else if (date >= prevStartStr) {
      accumulate(prev, r.type, amount, r.payment_status, remaining);
    }
  }

  const avgSale = cur.saleCount > 0 ? cur.sales / cur.saleCount : 0;
  const prevAvgSale = prev.saleCount > 0 ? prev.sales / prev.saleCount : 0;

  const totalCount =
    typeStats.sale.count + typeStats.purchase.count + typeStats.expense.count;
  const totalAmount =
    typeStats.sale.amount + typeStats.purchase.amount + typeStats.expense.amount;

  const byType = (["purchase", "expense", "sale"] as const).map((t) => ({
    type: t,
    count: typeStats[t].count,
    amount: round2(typeStats[t].amount),
    pct_count: totalCount > 0 ? round1((typeStats[t].count / totalCount) * 100) : 0,
    pct_amount: totalAmount > 0 ? round1((typeStats[t].amount / totalAmount) * 100) : 0,
  }));

  return Response.json(
    {
      range: rangeKey,
      has_previous: prev.sales + prev.purchases + prev.expenses + prev.receivables + prev.payables > 0,
      cards: {
        total_sales: { value: round2(cur.sales), change: change(cur.sales, prev.sales) },
        total_purchases: { value: round2(cur.purchases), change: change(cur.purchases, prev.purchases) },
        total_expenses: { value: round2(cur.expenses), change: change(cur.expenses, prev.expenses) },
        outstanding_receivables: { value: round2(cur.receivables), change: change(cur.receivables, prev.receivables) },
        outstanding_payables: { value: round2(cur.payables), change: change(cur.payables, prev.payables) },
        avg_sales_value: { value: round2(avgSale), change: change(avgSale, prevAvgSale) },
      },
      avg_monthly_sales: round2(cur.sales / n),
      sales_growth_pct: change(cur.sales, prev.sales),
      months: buckets.map((b) => ({
        month: b.key,
        label: b.label,
        sales: round2(b.sales),
        purchases: round2(b.purchases),
        expenses: round2(b.expenses),
      })),
      by_type: byType,
      total_count: totalCount,
      total_amount: round2(totalAmount),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}