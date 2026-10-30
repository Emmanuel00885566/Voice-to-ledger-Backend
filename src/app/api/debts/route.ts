import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "@/lib/auth";
import { serverError } from "@/lib/errors";
import { getPaidByTransaction, outstandingOf, round2 } from "@/lib/debts";

const QuerySchema = z.object({
  status: z.enum(["open", "settled", "all"]).default("open"),
});

type Party = { name: string } | { name: string }[] | null;

type DebtRow = {
  id: string;
  type: "receivable" | "payable";
  amount: number | string;
  currency: string | null;
  payment_status: string;
  due_date: string | null;
  transaction_date: string;
  description: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  customers: Party;
  suppliers: Party;
};

const nameOf = (p: Party) => (Array.isArray(p) ? p[0]?.name : p?.name) ?? null;

async function getUserBusinessId(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from("businesses")
    .select("id")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[api/debts getUserBusinessId]", error.message);
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

  const query = QuerySchema.safeParse({
    status: new URL(request.url).searchParams.get("status") ?? undefined,
  });
  if (!query.success) {
    return Response.json(
      { error: "validation_failed", fields: query.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { businessId, error: businessError } = await getUserBusinessId(db, user.id);
  if (businessError || !businessId) {
    return Response.json({ error: businessError ?? "business_not_found" }, { status: 404 });
  }

  const { data, error } = await db
    .from("transactions")
    .select(
      "id, type, amount, currency, payment_status, due_date, transaction_date, description, customer_id, supplier_id, customers(name), suppliers(name)"
    )
    .eq("business_id", businessId)
    .in("type", ["receivable", "payable"])
    .order("transaction_date", { ascending: false });

  if (error) return serverError(error, "GET api/debts");

  const { paid, error: paidError } = await getPaidByTransaction(db, businessId);
  if (paidError || !paid) return serverError(paidError ?? { message: "no payments" }, "GET api/debts (payments)");

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

  const debts = ((data ?? []) as unknown as DebtRow[])
    .map((t) => {
      const amountPaid = round2(paid.get(t.id) ?? 0);
      const outstanding = outstandingOf(t.amount, amountPaid);
      const isCustomer = t.type === "receivable";
      return {
        id: t.id,
        type: t.type,
        party_id: isCustomer ? t.customer_id : t.supplier_id,
        party_name: (isCustomer ? nameOf(t.customers) : nameOf(t.suppliers)) ?? "Unassigned",
        description: t.description,
        currency: t.currency,
        amount: Number(t.amount),
        amount_paid: amountPaid,
        outstanding,
        payment_status: t.payment_status,
        transaction_date: t.transaction_date,
        due_date: t.due_date,
        overdue: outstanding > 0 && t.due_date !== null && t.due_date < today,
      };
    })
    .filter((d) =>
      query.data.status === "all" ? true : query.data.status === "open" ? d.outstanding > 0 : d.outstanding === 0
    );

  // Group by person (customer for receivables, supplier for payables)
  const group = (type: "receivable" | "payable") => {
    const parties = new Map<
      string,
      { party_id: string | null; party_name: string; total_outstanding: number; debts: typeof debts }
    >();

    for (const d of debts.filter((x) => x.type === type)) {
      const key = d.party_id ?? "unassigned";
      const entry =
        parties.get(key) ??
        { party_id: d.party_id, party_name: d.party_name, total_outstanding: 0, debts: [] as typeof debts };
      entry.total_outstanding = round2(entry.total_outstanding + d.outstanding);
      entry.debts.push(d);
      parties.set(key, entry);
    }

    const list = [...parties.values()].sort((a, b) => b.total_outstanding - a.total_outstanding);
    return {
      total_outstanding: round2(list.reduce((total, p) => total + p.total_outstanding, 0)),
      parties: list,
    };
  };

  return Response.json({
    receivables: group("receivable"),
    payables: group("payable"),
  });
}