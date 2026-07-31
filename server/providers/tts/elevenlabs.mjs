/**
 * ElevenLabs TTS provider — extracted from scripts/generate-audio.mjs so it can be
 * selected interchangeably with other providers via TTS_PROVIDER.
 *
 * synthesize() writes the mp3 to destPath and returns word-level timestamps in the
 * shared shape { word, start, end } (seconds) that scripts/generate-audio.mjs uses
 * for scene_duration / crossfade / timing_anchors math.
 */
import { writeFileSync } from "fs";

export const id = "elevenlabs";

export function extractWordTimestamps(chars, times) {
  const words = [];
  let word = "", start = null;
  for (let i = 0; i <= chars.length; i++) {
    const ch = i < chars.length ? chars[i] : " ";
    if (/[\s,.!?;:]/.test(ch)) {
      if (word) {
        words.push({ word, start, end: times[i - 1] ?? times[times.length - 1] });
        word = ""; start = null;
      }
    } else {
      if (start === null) start = times[i];
      word += ch;
    }
  }
  return words;
}

export async function synthesize({
  text,
  destPath,
  apiKey = process.env.ELEVENLABS_API_KEY,
  voiceId = process.env.ELEVENLABS_VOICE_ID || "3VnrjnYrskPMDsapTr8X",
  modelId = "eleven_turbo_v2_5",
}) {
  if (!apiKey) throw new Error("Missing ELEVENLABS_API_KEY");

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const audioBuf = Buffer.from(data.audio_base64, "base64");
  writeFileSync(destPath, audioBuf);

  const { characters, character_start_times_seconds } = data.alignment;
  const wordTimestamps = extractWordTimestamps(characters, character_start_times_seconds);
  const voDuration = character_start_times_seconds.at(-1) ?? 0;

  return { wordTimestamps, voDuration, audioBytes: audioBuf.length };
}
