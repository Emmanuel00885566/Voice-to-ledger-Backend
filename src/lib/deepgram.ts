import { DeepgramClient } from "@deepgram/sdk";

const apiKey = process.env.DEEPGRAM_API_KEY!;

if (!apiKey) {
  throw new Error("Missing DEEPGRAM_API_KEY. Check .env.local");
}

export const deepgram = new DeepgramClient({ apiKey });