import "server-only";
import { config } from "@/lib/env";
import { serviceUnavailable } from "@/lib/errors";
import { fetchWithTimeout, ensureOk } from "./http";
import { callWithRotation, groqPool } from "./keyPool";

const GROQ_SPEECH = "https://api.groq.com/openai/v1/audio/speech";

export const SPEECH_FORMAT = "wav";

const FALLBACK_MIME = "audio/wav";

export interface Speech {
  bytes: Uint8Array;
  mime: string;
}

export async function synthesize(text: string, voice: string): Promise<Speech> {
  if (groqPool.isEmpty) {
    throw serviceUnavailable("Speech is unavailable: no Groq keys configured.", "tts_unavailable");
  }

  const speech = await callWithRotation(groqPool, async (key) => {
    const res = await ensureOk(
      await fetchWithTimeout(
        GROQ_SPEECH,
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: config.tts.model,
            voice,
            input: text,
            response_format: SPEECH_FORMAT,
          }),
        },
        config.rotation.providerTimeoutMs,
      ),
      "groq-tts",
    );

    const mime = (res.headers.get("content-type") ?? FALLBACK_MIME).split(";")[0]?.trim();
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: mime || FALLBACK_MIME };
  });

  if (speech.bytes.byteLength === 0) {
    throw serviceUnavailable("Speech provider returned an empty clip.", "tts_empty");
  }
  return speech;
}
