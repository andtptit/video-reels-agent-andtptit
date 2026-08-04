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
import { CancelledError } from "../../jobs/cancel-registry.mjs";

export const id = "edge-tts";

const TICKS_PER_SECOND = 1e7;
const DEFAULT_VOICE = process.env.EDGE_TTS_VOICE || "vi-VN-HoaiMyNeural";
// 1.1 = 10% faster than natural — user's requested default for short-form video
// pacing. msedge-tts's ProsodyOptions.rate accepts a plain relative number like this
// directly (confirmed via server/node_modules/msedge-tts/dist/Prosody.d.ts).
const DEFAULT_RATE = Number(process.env.EDGE_TTS_RATE) || 1.1;

export async function synthesize({ text, destPath, voiceId = DEFAULT_VOICE, rate = DEFAULT_RATE, signal }) {
  if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();

  const tts = new MsEdgeTTS();

  // `MsEdgeTTS.close()` is the library's public method for tearing down the
  // WebSocket mid-synthesis (confirmed via its .d.ts) — closing it before "turn.end"
  // is exactly the same code path that already produces the "Stream closed before
  // the synthesis completed..." error (the transient chập chờn bug fixed earlier),
  // so we tell the two apart below by checking `signal.aborted` once the streams
  // reject, not by trying to special-case the error message.
  //
  // Registered BEFORE `setMetadata` (not after `toStream`, where it lived in an
  // earlier version of this function) — confirmed live this was a real bug: an abort
  // firing while `setMetadata`'s WebSocket handshake is still in flight has no
  // listener yet at that point, and `addEventListener` on an already-fired
  // AbortSignal does NOT retroactively replay the event, so the cancel was silently
  // swallowed and `synthesize()` hung until the real network response eventually
  // arrived (or never returned within a test's timeout at all).
  const onAbort = () => tts.close();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: true,
    });
  } catch (err) {
    signal?.removeEventListener("abort", onAbort);
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    throw err;
  }

  const { audioStream, metadataStream } = tts.toStream(text, { rate });

  const audioChunks = [];
  const metadataItems = [];

  try {
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
  } catch (err) {
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

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
