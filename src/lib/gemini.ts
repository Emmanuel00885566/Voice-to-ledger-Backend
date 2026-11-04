import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY!;

if (!apiKey) {
  throw new Error("Missing GEMINI_API_KEY. Check .env.local");
}

export const genAI = new GoogleGenerativeAI(apiKey);

const PRIMARY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
// Optional. If it is not set, only the primary model is used.
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Temporary Google-side problems worth retrying
function isBusy(err: unknown) {
  const status = (err as { status?: number })?.status;
  const msg = (err as Error)?.message ?? "";
  return status === 503 || status === 429 || status === 500 || /\b(503|429|500)\b/.test(msg);
}

// Main model up to 5 times with growing pauses, then the fallback once (if set)
export async function generateText(prompt: string): Promise<string> {
  const plan: string[] = [PRIMARY_MODEL, PRIMARY_MODEL, PRIMARY_MODEL, PRIMARY_MODEL, PRIMARY_MODEL];
  if (FALLBACK_MODEL && FALLBACK_MODEL !== PRIMARY_MODEL) plan.push(FALLBACK_MODEL);

  let lastError: unknown;

  for (let i = 0; i < plan.length; i++) {
    try {
      const model = genAI.getGenerativeModel({ model: plan[i] });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      lastError = err;
      console.error(`[gemini] attempt ${i + 1} (${plan[i]}) failed:`, (err as Error).message);
      // A bad request or bad key will not fix itself on the same model
      if (!isBusy(err) && plan[i] === PRIMARY_MODEL) break;
      if (i < plan.length - 1) await sleep(900 * (i + 1));
    }
  }
  throw lastError;
}