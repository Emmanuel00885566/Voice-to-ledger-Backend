import { DeepgramError } from "@deepgram/sdk";
import type { ListenV1Response } from "@deepgram/sdk";
import { deepgram } from "@/lib/deepgram";
import { getAuthenticatedUser } from "@/lib/auth";

// Upload limits (threat model T-17): keeps one request from being huge or off-topic
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  const { user, error: authError } = await getAuthenticatedUser(request);

  if (authError || !user) {
    return Response.json({ error: authError }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "invalid_form_data" }, { status: 400 });
  }

  const audioFile = formData.get("audio");

  if (!(audioFile instanceof File)) {
    return Response.json({ error: "No audio file provided" }, { status: 400 });
  }

  if (audioFile.size === 0) {
    return Response.json({ error: "empty_audio_file" }, { status: 400 });
  }

  if (audioFile.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "audio_too_large", max_bytes: MAX_AUDIO_BYTES }, { status: 413 });
  }

  if (audioFile.type && !audioFile.type.startsWith("audio/") && audioFile.type !== "application/octet-stream") {
    return Response.json({ error: "unsupported_file_type" }, { status: 415 });
  }

  // The audio is only held in memory for this request. It is never saved.
  const buffer = Buffer.from(await audioFile.arrayBuffer());

  try {
    const response = (await deepgram.listen.v1.media.transcribeFile(buffer, {
      model: "nova-2",
      language: "en", // we'll test Pidgin accuracy separately
      smart_format: true,
    })) as ListenV1Response;

    const transcript =
      response?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

    if (!transcript) {
      return Response.json(
        { error: "transcription_failed", message: "Could not understand audio, please try again or type manually" },
        { status: 422 }
      );
    }

    return Response.json({ transcript, language_detected: "en" });
  } catch (err) {
    // Provider details stay in the server log, not in the response (T-18)
    console.error("[api/voice/transcribe]", (err as Error).message);

    if (err instanceof DeepgramError) {
      return Response.json(
        { error: "transcription_failed", message: "Could not transcribe the audio, please try again or type manually" },
        { status: 422 }
      );
    }
    return Response.json(
      { error: "transcription_failed", message: "Something went wrong, please try again" },
      { status: 500 }
    );
  }
}
