import { getAuthenticatedUser } from "@/lib/auth";
import { serverError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { rateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { dateOnlySchema } from "@/lib/validation";

type NameRef = { name: string | null } | { name: string | null }[] | null;

type Row = {
  transaction_date: string | null;
  type: string | null;
  description: string | null;
  product_name: string | null;
  amount: number | string | null;
  payment_status: string | null;
  customers: NameRef;
  suppliers: NameRef;
};

function nameOf(ref: NameRef): string {
  if (!ref) return "";
  if (Array.isArray(ref)) return ref[0]?.name ?? "";
  return ref.name ?? "";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function GET(request: Request) {
  const { user, db, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user || !db) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const limited = rateLimit("export", user.id, 5, 60_000);
  if (!limited.allowed) return rateLimitedResponse(limited.retryAfterSeconds);

  const { data: business, error: bizError } = await db
    .from("businesses")
    .select("*")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (bizError) return serverError(bizError, "export.summary.business");
  if (!business) {
    return Response.json({ error: "business_not_found" }, { status: 404 });
  }

  const biz = business as Record<string, unknown>;
  const businessName =
    (typeof biz.name === "string" && biz.name) ||
    (typeof biz.business_name === "string" && biz.business_name) ||
    "My Business";

  const url = new URL(request.url);
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");

  let query = db
    .from("transactions")
    .select(
      "transaction_date,type,description,product_name,amount,payment_status,customers(name),suppliers(name)"
    )
    .eq("business_id", business.id)
    .order("transaction_date", { ascending: false })
    .limit(10000);

  if (fromRaw) {
    const p = dateOnlySchema.safeParse(fromRaw);
    if (!p.success) return Response.json({ error: "invalid_from" }, { status: 400 });
    query = query.gte("transaction_date", p.data);
  }
  if (toRaw) {
    const p = dateOnlySchema.safeParse(toRaw);
    if (!p.success) return Response.json({ error: "invalid_to" }, { status: 400 });
    query = query.lte("transaction_date", p.data);
  }

  const { data, error } = await query;
  if (error) return serverError(error, "export.summary.transactions");

  const rows = (data ?? []) as unknown as Row[];

  const totals = { sales: 0, purchases: 0, expenses: 0, receivables: 0, payables: 0 };
  const outstanding = {
    receivables_count: 0,
    receivables_value: 0,
    payables_count: 0,
    payables_value: 0,
  };
  const monthMap = new Map<string, { sales: number; costs: number }>();

  for (const r of rows) {
    const amount = Number(r.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    const month = (r.transaction_date ?? "").slice(0, 7);
    const m = monthMap.get(month) ?? { sales: 0, costs: 0 };

    switch (r.type) {
      case "sale":
        totals.sales += amount;
        m.sales += amount;
        break;
      case "purchase":
        totals.purchases += amount;
        m.costs += amount;
        break;
      case "expense":
        totals.expenses += amount;
        m.costs += amount;
        break;
      case "receivable":
        totals.receivables += amount;
        if (r.payment_status !== "paid") {
          outstanding.receivables_count += 1;
          outstanding.receivables_value += amount;
        }
        break;
      case "payable":
        totals.payables += amount;
        if (r.payment_status !== "paid") {
          outstanding.payables_count += 1;
          outstanding.payables_value += amount;
        }
        break;
      default:
        break;
    }
    if (month) monthMap.set(month, m);
  }

  const net = totals.sales - totals.purchases - totals.expenses;

  const months = Array.from(monthMap.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, v]) => ({
      month,
      sales: round2(v.sales),
      costs: round2(v.costs),
      net: round2(v.sales - v.costs),
    }));

  const recent = rows.slice(0, 25).map((r) => ({
    date: r.transaction_date,
    type: r.type,
    item: r.product_name || r.description || "",
    party: nameOf(r.customers) || nameOf(r.suppliers),
    amount: Number(r.amount ?? 0),
    status: r.payment_status,
  }));

  await logAudit({
    db,
    userId: user.id,
    businessId: business.id,
    action: "export",
    entityType: "transaction",
    entityId: business.id,
    oldValues: null,
    newValues: { format: "pdf", rows: rows.length, from: fromRaw, to: toRaw },
  });

  return Response.json(
    {
      business: { name: businessName },
      period: { from: fromRaw, to: toRaw },
      generated_at: new Date().toISOString(),
      transaction_count: rows.length,
      totals: {
        sales: round2(totals.sales),
        purchases: round2(totals.purchases),
        expenses: round2(totals.expenses),
        receivables: round2(totals.receivables),
        payables: round2(totals.payables),
        net: round2(net),
      },
      outstanding: {
        receivables_count: outstanding.receivables_count,
        receivables_value: round2(outstanding.receivables_value),
        payables_count: outstanding.payables_count,
        payables_value: round2(outstanding.payables_value),
      },
      months,
      recent,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}