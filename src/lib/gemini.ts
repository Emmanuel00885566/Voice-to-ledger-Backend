
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error(
    "Missing GEMINI_API_KEY. Check your environment variables."
  );
}

const ai = new GoogleGenAI({ apiKey });

const PRIMARY_MODEL =
  process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";

const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL;

// Optional. Leave unset to use the model's default thinking level.
const THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL
  ?.trim()
  .toLowerCase();

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Identify temporary errors that are worth retrying.
function isRetryableError(err: unknown): boolean {
  const error = err as {
    status?: number;
    message?: string;
    name?: string;
  };

  const status = error.status;
  const message = error.message ?? "";
  const name = error.name ?? "";

  return (
    status === 429 ||
    status === 500 ||
    status === 503 ||
    name === "TimeoutError" ||
    name === "AbortError" ||
    /\b(429|500|503)\b/.test(message)
  );
}

// Authentication errors will not be fixed by switching models.
function isAuthenticationError(err: unknown): boolean {
  const error = err as {
    status?: number;
  };

  return error.status === 401 || error.status === 403;
}

export async function generateText(
  prompt: string
): Promise<string> {
  const modelPlan = [
    {
      model: PRIMARY_MODEL,
      attempts: 3,
    },
    ...(FALLBACK_MODEL && FALLBACK_MODEL !== PRIMARY_MODEL
      ? [
          {
            model: FALLBACK_MODEL,
            attempts: 1,
          },
        ]
      : []),
  ];

  let lastError: unknown;

  for (const modelConfig of modelPlan) {
    for (
      let attempt = 1;
      attempt <= modelConfig.attempts;
      attempt++
    ) {
      const started = Date.now();

      try {
        const response = await ai.models.generateContent({
          model: modelConfig.model,
          contents: prompt,
          config: {
            temperature: 0,
            responseMimeType: "application/json",

            ...(THINKING_LEVEL === "low"
              ? {
                  thinkingConfig: {
                    thinkingLevel: ThinkingLevel.LOW,
                  },
                }
              : {}),

            abortSignal: AbortSignal.timeout(12000),
          },
        });

        const duration = Date.now() - started;

        console.log(
          `[gemini] ${modelConfig.model} succeeded in ${duration}ms (attempt ${attempt})`
        );

        return response.text ?? "";

      } catch (err) {
        lastError = err;

        const duration = Date.now() - started;

        const errorMessage =
          err instanceof Error ? err.message : String(err);

        console.error(
          `[gemini] ${modelConfig.model} failed in ${duration}ms (attempt ${attempt}):`,
          errorMessage
        );

        // Do not retry invalid API keys or forbidden access.
        if (isAuthenticationError(err)) {
          throw err;
        }

        // Move to the fallback model if this error is not temporary.
        if (!isRetryableError(err)) {
          break;
        }

        // Wait only when another attempt for the same model remains.
        if (attempt < modelConfig.attempts) {
          await sleep(900 * attempt);
        }
      }
    }
  }

  throw lastError ?? new Error("Gemini request failed.");
}
