/**
 * Edge TTS provider (free, no API key) — same interface as elevenlabs.mjs so
 * scripts/generate-audio.mjs can swap providers via TTS_PROVIDER without touching
 * the timing math downstream.
 *
 * Word-boundary offsets from the Edge Read Aloud API are in 100-nanosecond units
 * (Windows ticks), same unit MsEdgeTTS itself uses internally for Sec-MS-GEC — divide
 * by 1e7 to get seconds.
 */
import { writeFileSync } from "fs";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

export const id = "edge-tts";

const TICKS_PER_SECOND = 1e7;
const DEFAULT_VOICE = process.env.EDGE_TTS_VOICE || "vi-VN-HoaiMyNeural";

export async function synthesize({ text, destPath, voiceId = DEFAULT_VOICE }) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
  });

  const { audioStream, metadataStream } = tts.toStream(text);

  const audioChunks = [];
  const metadataItems = [];

  await Promise.all([
    new Promise((resolve, reject) => {
      audioStream.on("data", (chunk) => audioChunks.push(chunk));
      audioStream.once("error", reject);
      audioStream.once("close", resolve);
    }),
    new Promise((resolve, reject) => {
      metadataStream.on("data", (chunk) => {
        try {
          const parsed = JSON.parse(chunk.toString());
          metadataItems.push(...(parsed.Metadata ?? []));
        } catch {
          // ignore malformed metadata chunk — audio is unaffected
        }
      });
      metadataStream.once("error", reject);
      metadataStream.once("close", resolve);
    }),
  ]);

  const audioBuf = Buffer.concat(audioChunks);
  if (!audioBuf.length) throw new Error("Edge TTS returned no audio data");
  writeFileSync(destPath, audioBuf);

  const wordTimestamps = metadataItems
    .filter((item) => item.Type === "WordBoundary")
    .map((item) => ({
      word: item.Data.text.Text,
      start: item.Data.Offset / TICKS_PER_SECOND,
      end: (item.Data.Offset + item.Data.Duration) / TICKS_PER_SECOND,
    }));

  const voDuration = wordTimestamps.at(-1)?.end ?? 0;

  return { wordTimestamps, voDuration, audioBytes: audioBuf.length };
}
