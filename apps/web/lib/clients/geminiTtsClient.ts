import "server-only";
import { config } from "@/lib/env";
import { pcm16ToWav, readPcmRate } from "@/lib/audio/wav";
import { fetchWithTimeout, ensureOk } from "./http";
import { callWithRotation, geminiPool } from "./keyPool";
import type { Speech } from "./ttsClient";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export function buildGeminiTtsBody(text: string, voiceName: string): Record<string, unknown> {
  return {
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  };
}

export async function synthesizeGemini(text: string, voiceName: string): Promise<Speech> {
  return callWithRotation(geminiPool, async (key) => {
    const url = `${GEMINI_BASE}/models/${config.tts.geminiModel}:generateContent?key=${key}`;
    const res = await ensureOk(
      await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildGeminiTtsBody(text, voiceName)),
        },
        config.rotation.providerTimeoutMs,
      ),
      "gemini-tts",
    );
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
    };
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error("gemini-tts: no audio part in response");
    const pcm = new Uint8Array(Buffer.from(part.inlineData.data, "base64"));
    if (pcm.byteLength === 0) throw new Error("gemini-tts: empty audio");
    return { bytes: pcm16ToWav(pcm, readPcmRate(part.inlineData.mimeType)), mime: "audio/wav" };
  });
}
