
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("Missing GEMINI_API_KEY. Check your environment variables.");
}

const ai = new GoogleGenAI({ apiKey });

const PRIMARY_MODEL =
  process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL;

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function isBusy(err: unknown) {
  const error = err as {
    status?: number;
    message?: string;
  };

  const status = error.status;
  const message = error.message ?? "";

  return (
    status === 429 ||
    status === 500 ||
    status === 503 ||
    /\b(429|500|503)\b/.test(message)
  );
}

export async function generateText(
  prompt: string
): Promise<string> {
  const plan: string[] = [
    PRIMARY_MODEL,
    PRIMARY_MODEL,
    PRIMARY_MODEL,
  ];

  if (FALLBACK_MODEL && FALLBACK_MODEL !== PRIMARY_MODEL) {
    plan.push(FALLBACK_MODEL);
  }

  let lastError: unknown;

  for (let i = 0; i < plan.length; i++) {
    const started = Date.now();

    try {
      const response = await ai.models.generateContent({
        model: plan[i],
        contents: prompt,
        config: {
          temperature: 0,
          responseMimeType: "application/json",
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
        },
      });

      const duration = Date.now() - started;

      console.log(
        `[gemini] ${plan[i]} succeeded in ${duration}ms (attempt ${i + 1})`
      );

      return response.text ?? "";

    } catch (err) {
      lastError = err;

      const duration = Date.now() - started;

      const error = err as Error;

      console.error(
        `[gemini] ${plan[i]} failed in ${duration}ms (attempt ${i + 1}):`,
        error.message
      );

      if (!isBusy(err) && plan[i] === PRIMARY_MODEL) {
        break;
      }

      if (i < plan.length - 1) {
        await sleep(900 * (i + 1));
      }
    }
  }

  throw lastError;
}
