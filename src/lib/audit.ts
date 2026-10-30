import type { SupabaseClient } from "@supabase/supabase-js";

type AuditInput = {
  db: SupabaseClient;
  userId: string;
  businessId: string | null;
  action: "create" | "update" | "delete";
    entityType: "transaction" | "customer" | "supplier" | "debt_payment";
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
};

// Writes one row to audit_events (threat model T-07 / SR-12).
// If the audit write fails we log the problem on the server but do not fail the
// user's request, so a logging problem can never block someone from recording a sale.
export async function logAudit(input: AuditInput) {
  const { error } = await input.db.from("audit_events").insert({
    user_id: input.userId,
    business_id: input.businessId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    old_values: input.oldValues ?? null,
    new_values: input.newValues ?? null,
  });

  if (error) {
    console.error("[audit] failed to write audit event:", error.message);
  }
}