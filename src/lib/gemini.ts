import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY!;

if (!apiKey) {
  throw new Error("Missing GEMINI_API_KEY. Check .env.local");
}

export const genAI = new GoogleGenerativeAI(apiKey);

const PRIMARY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-2.5-flash";

export const geminiModel = genAI.getGenerativeModel({ model: PRIMARY_MODEL });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Temporary Google-side problems worth retrying
function isRetryable(err: unknown) {
  const status = (err as { status?: number })?.status;
  const msg = (err as Error)?.message ?? "";
  return status === 503 || status === 429 || status === 500 || /\b(503|429|500)\b/.test(msg);
}

// Tries the main model twice, then the fallback model twice
export async function generateText(prompt: string): Promise<string> {
  const models = [PRIMARY_MODEL, PRIMARY_MODEL, FALLBACK_MODEL, FALLBACK_MODEL];
  let lastError: unknown;

  for (let i = 0; i < models.length; i++) {
    try {
      const model = genAI.getGenerativeModel({ model: models[i] });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      lastError = err;
      console.error(`[gemini] attempt ${i + 1} (${models[i]}) failed:`, (err as Error).message);
      if (!isRetryable(err)) break;
      await sleep(700 * (i + 1));
    }
  }
  throw lastError;
}