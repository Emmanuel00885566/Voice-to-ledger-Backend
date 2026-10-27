// Returns a generic 500 to the client and keeps the real details in the server logs only.
// This stops database table/column names from leaking in responses (threat model T-18).
export function serverError(error: { message: string }, context: string) {
  console.error(`[${context}]`, error.message);
  return Response.json({ error: "internal_error" }, { status: 500 });
}
