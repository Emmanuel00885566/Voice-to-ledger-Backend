import { getAuthenticatedUser } from "@/lib/auth";
import { serverError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { rateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { dateOnlySchema } from "@/lib/validation";

const COLUMNS = [
  "transaction_date",
  "type",
  "description",
  "product_name",
  "quantity",
  "unit",
  "amount",
  "currency",
  "payment_status",
  "due_date",
  "customer",
  "supplier",
  "input_method",
  "notes",
] as const;

type Column = (typeof COLUMNS)[number];

type NameRef = { name: string | null } | { name: string | null }[] | null;

type TransactionRow = {
  transaction_date: string | null;
  type: string | null;
  description: string | null;
  product_name: string | null;
  quantity: number | null;
  unit: string | null;
  amount: number | null;
  currency: string | null;
  payment_status: string | null;
  due_date: string | null;
  input_method: string | null;
  notes: string | null;
  customers: NameRef;
  suppliers: NameRef;
};

function nameOf(ref: NameRef): string {
  if (!ref) return "";
  if (Array.isArray(ref)) return ref[0]?.name ?? "";
  return ref.name ?? "";
}

// Stops Excel/Sheets from running a cell as a formula (CSV injection)
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
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
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (bizError) return serverError(bizError, "export.business");
  if (!business) {
    return Response.json({ error: "business_not_found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");

  let query = db
    .from("transactions")
    .select(
      "transaction_date,type,description,product_name,quantity,unit,amount,currency,payment_status,due_date,input_method,notes,customers(name),suppliers(name)"
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
  if (error) return serverError(error, "export.transactions");

  const rows = (data ?? []) as unknown as TransactionRow[];

  const lines: string[] = [COLUMNS.join(",")];
  for (const r of rows) {
    const flat: Record<Column, unknown> = {
      transaction_date: r.transaction_date,
      type: r.type,
      description: r.description,
      product_name: r.product_name,
      quantity: r.quantity,
      unit: r.unit,
      amount: r.amount,
      currency: r.currency,
      payment_status: r.payment_status,
      due_date: r.due_date,
      customer: nameOf(r.customers),
      supplier: nameOf(r.suppliers),
      input_method: r.input_method,
      notes: r.notes,
    };
    lines.push(COLUMNS.map((c) => cell(flat[c])).join(","));
  }
  // BOM so Excel reads the file as UTF-8
  const csv = "\uFEFF" + lines.join("\r\n");

  await logAudit({
    db,
    userId: user.id,
    businessId: business.id,
    action: "export",
    entityType: "transaction",
    entityId: business.id,
    oldValues: null,
    newValues: { rows: rows.length, from: fromRaw, to: toRaw },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trade-padi-transactions-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}