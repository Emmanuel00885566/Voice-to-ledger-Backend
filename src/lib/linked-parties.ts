import type { SupabaseClient } from "@supabase/supabase-js";
import { serverError } from "@/lib/errors";

// Makes sure a customer / supplier id belongs to this business before a transaction links to it.
// Returns a ready-made error Response, or null when everything is fine.
export async function checkLinkedParties(
  db: SupabaseClient,
  businessId: string,
  customerId?: string,
  supplierId?: string
): Promise<Response | null> {
  if (customerId) {
    const { data, error } = await db
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (error) return serverError(error, "checkLinkedParties customer");
    if (!data) return Response.json({ error: "customer_not_found" }, { status: 404 });
  }

  if (supplierId) {
    const { data, error } = await db
      .from("suppliers")
      .select("id")
      .eq("id", supplierId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (error) return serverError(error, "checkLinkedParties supplier");
    if (!data) return Response.json({ error: "supplier_not_found" }, { status: 404 });
  }

  return null;
}