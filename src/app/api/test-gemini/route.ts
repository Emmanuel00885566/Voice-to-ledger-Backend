import { geminiModel } from "@/lib/gemini";

export async function GET() {
  try {
    const result = await geminiModel.generateContent(
      "Say hello in one short sentence."
    );
    const text = result.response.text();
    return Response.json({ working: true, response: text });
  } catch (error) {
    return Response.json(
      { working: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}