import { deepgram } from "@/lib/deepgram";
import { getAuthenticatedUser } from "@/lib/auth";

export async function POST(request: Request) {
  const { user, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user) {
    return Response.json({ error: authError }, { status: 401 });
  }

  const formData = await request.formData();
  const audioFile = formData.get("audio") as File | null;

  if (!audioFile) {
    return Response.json({ error: "No audio file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await audioFile.arrayBuffer());

  try {
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      buffer,
      {
        model: "nova-2",
        language: "en", // we'll test Pidgin accuracy separately
        smart_format: true,
      }
    );

    if (error) {
      return Response.json(
        { error: "transcription_failed", message: error.message },
        { status: 422 }
      );
    }

    const transcript =
      result?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

    if (!transcript) {
      return Response.json(
        { error: "transcription_failed", message: "Could not understand audio, please try again or type manually" },
        { status: 422 }
      );
    }

    return Response.json({ transcript, language_detected: "en" });
  } catch (err) {
    return Response.json(
      { error: "transcription_failed", message: (err as Error).message },
      { status: 500 }
    );
  }
}