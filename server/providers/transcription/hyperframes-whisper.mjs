/**
 * Local Whisper transcription via HyperFrames CLI (whisper.cpp under the hood) — free,
 * no API key, already a dependency of this workspace. Mirrors the TTS provider shape
 * (server/providers/tts/*.mjs, e.g. `synthesize({...}) -> {wordTimestamps, voDuration}`)
 * so a second provider (e.g. ElevenLabs Scribe) can slot in later via a lookup map in
 * audio-import.mjs, the same way TTS_PROVIDERS works in generate-audio.mjs, without
 * touching call sites.
 *
 * Engine is hard-pinned to "whisper" (never "auto"/"parakeet") — Vietnamese support is
 * only confirmed for whisper models; Parakeet is Apple-Silicon-only and wasn't part of
 * what got verified. `.en` models are never used here — this workspace's own
 * hyperframes-media skill warns `.en` models TRANSLATE instead of transcribing
 * non-English speech, so callers must pass `language` whenever the audio isn't English.
 */
import { transcribe as hyperframesTranscribe } from "../../tools/hyperframes-cli.mjs";

export const id = "hyperframes-whisper";

/**
 * @param {{srcPath: string, language?: string, model?: string, signal?: AbortSignal}} params
 * @returns {Promise<{words: {word: string, start: number, end: number}[], fullText: string}>}
 */
export async function transcribe({ srcPath, language, model = "small", signal }) {
  // CLI's own JSON uses `text` per word (see hyperframes-cli.mjs's doc comment on
  // transcribe()) — renamed to `word` here so nothing downstream (transcript-clean.mjs,
  // caption-chunks.mjs, the scene-timing-assembler) needs to know the source wasn't TTS.
  const { words } = await hyperframesTranscribe(srcPath, { engine: "whisper", model, language, signal });
  const mapped = words.map((w) => ({ word: w.text ?? w.word, start: w.start, end: w.end }));
  return { words: mapped, fullText: mapped.map((w) => w.word).join(" ") };
}
