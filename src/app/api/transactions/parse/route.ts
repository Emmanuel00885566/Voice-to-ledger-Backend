import { z } from "zod";
import { geminiModel } from "@/lib/gemini";
import { getAuthenticatedUser } from "@/lib/auth";

const TransactionTypeEnum = z.enum([
  "sale",
  "purchase",
  "expense",
  "receivable",
  "payable",
]);

const PaymentStatusEnum = z.enum(["paid", "unpaid", "partially_paid"]);

const ExtractedTransactionSchema = z.object({
  type: TransactionTypeEnum,
  product_name: z.string().nullable(),
  quantity: z.number().positive().nullable(),
  unit: z.string().nullable(),
  amount: z.number().positive(),
  currency: z.literal("NGN"),
  customer_name: z.string().nullable(),
  supplier_name: z.string().nullable(),
  payment_status: PaymentStatusEnum,
  notes: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export async function POST(request: Request) {
  const { user, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const body = await request.json();
  const text = body?.text as string | undefined;

  if (!text || text.trim().length === 0) {
    return Response.json({ error: "No text provided" }, { status: 400 });
  }

  const today = new Date().toISOString().split("T")[0];

  const prompt = `You are extracting a business transaction from a sentence spoken by a Nigerian trader. The sentence may be in English or Nigerian Pidgin.

Sentence: "${text}"

Extract the transaction as JSON matching exactly this shape, with no extra text, no markdown code fences, just raw JSON:

{
  "type": "sale" | "purchase" | "expense" | "receivable" | "payable",
  "product_name": string or null,
  "quantity": number or null,
  "unit": string or null (e.g. "yards", "pieces", "bags"),
  "amount": number (required, in Naira, no currency symbol, no commas),
  "currency": "NGN",
  "customer_name": string or null,
  "supplier_name": string or null,
  "payment_status": "paid" | "unpaid" | "partially_paid" (default to "paid" if not mentioned),
  "notes": string or null,
  "confidence": number between 0 and 1, your confidence this extraction is correct
}

Rules:
- "sold" or "sale" means type "sale"
- "bought" or "purchased" means type "purchase"
- "spent" on running the business (transport, rent, etc.) means type "expense"
- "collected on credit" or similar, where the business now owes someone, means type "payable"
- If someone owes the business money, means type "receivable"
- If the amount is unclear or missing, set amount to 0 and confidence to 0
- Today's date is ${today}, but do not include a date field in your output, it will be added separately`;

  try {
    const result = await geminiModel.generateContent(prompt);
    const rawText = result.response.text();

    const cleaned = rawText.replace(/```json\s*|\s*```/g, "").trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return Response.json(
        { error: "extraction_failed", message: "Could not understand the transaction, please try again or enter manually" },
        { status: 422 }
      );
    }

    const validated = ExtractedTransactionSchema.safeParse(parsed);

    if (!validated.success) {
      return Response.json(
        { error: "extraction_failed", message: "Could not understand the transaction, please try again or enter manually" },
        { status: 422 }
      );
    }

    if (validated.data.amount === 0) {
      return Response.json(
        { error: "extraction_failed", message: "Could not understand the amount, please try again or enter manually" },
        { status: 422 }
      );
    }

    return Response.json(validated.data);
  } catch (err) {
    return Response.json(
      { error: "extraction_failed", message: (err as Error).message },
      { status: 500 }
    );
  }
}