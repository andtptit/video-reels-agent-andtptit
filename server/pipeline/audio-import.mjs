/**
 * "Tạo project từ audio có sẵn" — the entry point that replaces "ý tưởng →
 * content-planner → TTS" (steps 1-2 of CLAUDE.md's workflow) with "audio đã có sẵn →
 * transcribe → cắt cảnh theo ý nghĩa → cắt audio gốc theo từng cảnh". From video-plan
 * onward the pipeline is completely unchanged — this only needs to produce the same
 * scenes.json + scenes-with-timing.json shape content-planner/generate-audio.mjs
 * already produce.
 *
 * Sequence: transcribe (provider) → quality check → clean → LLM scene-cut (word-index
 * boundaries, see audio-scene-cutter.mjs) → per-scene ffmpeg cut of the REAL source
 * audio → assembleScenesWithTiming (shared with generate-audio.mjs).
 */
import { mkdirSync, existsSync, writeFileSync } from "fs";
import { join, resolve, dirname } from "path";
import * as hyperframesWhisper from "../providers/transcription/hyperframes-whisper.mjs";
import { cutAudioClip } from "../tools/ffmpeg-cli.mjs";
import { cleanTranscriptWords, checkTranscriptQuality } from "../lib/transcript-clean.mjs";
import { runAudioSceneCutter } from "../agents/audio-scene-cutter.mjs";
import { assembleScenesWithTiming } from "./scene-timing-assembler.mjs";
import { CancelledError } from "../jobs/cancel-registry.mjs";

// Mirrors generate-audio.mjs's TTS_PROVIDERS lookup — only 1 entry implemented today
// (local Whisper via HyperFrames CLI, free, no API key, confirmed Vietnamese-capable),
// but a second provider (e.g. ElevenLabs Scribe) slots in later without touching the
// rest of this file.
const TRANSCRIPTION_PROVIDERS = { "hyperframes-whisper": hyperframesWhisper };

// A trailing pad on the CUT AUDIO FILE's end boundary only (not on voDuration/word
// timestamps) — avoids clipping a trailing consonant right at the LLM-chosen word
// boundary. Mirrors the spirit of scene-timing-assembler.mjs's SCENE_DURATION_BUFFER
// (a gap after speech), but at the file-cut level rather than the timeline level —
// the two are independent and both apply.
const CLIP_TRAILING_PAD_SEC = 0.15;

/**
 * @param {object} params
 * @param {string} params.projectDir
 * @param {string} params.sourceFile - absolute path to the uploaded audio file
 *   (routes.mjs's multer storage already writes it to
 *   `<projectDir>/assets/source/source.<ext>` — this function references it in
 *   place, no copy)
 * @param {string} [params.language] - e.g. "vi" — required for non-English audio
 *   (see hyperframes-whisper.mjs's doc comment on why this can't be guessed)
 * @param {string} [params.whisperModel] - "small" | "medium" | "large-v3"...
 * @param {string} [params.model] - LLM model for the scene-cut agent
 * @param {string} [params.platform] - "9:16" | "16:9" — written into scenes.json,
 *   same field content-planner's own output carries
 * @param {string} [params.musicTrack]
 * @param {number} [params.musicVolume] - 0-1
 * @param {(e: object) => void} [params.onEvent]
 * @param {AbortSignal} [params.signal]
 */
export async function runAudioImport({
  projectDir,
  sourceFile,
  language,
  whisperModel = "small",
  model,
  platform = "9:16",
  musicTrack,
  musicVolume,
  onEvent = () => {},
  signal,
}) {
  const providerId = process.env.TRANSCRIPTION_PROVIDER || "hyperframes-whisper";
  const provider = TRANSCRIPTION_PROVIDERS[providerId];
  if (!provider) throw new Error(`Unknown TRANSCRIPTION_PROVIDER "${providerId}". Valid: ${Object.keys(TRANSCRIPTION_PROVIDERS).join(", ")}`);

  const projectAbs = resolve(projectDir);
  const sourceDest = resolve(sourceFile);
  const sourceDir = dirname(sourceDest);
  mkdirSync(sourceDir, { recursive: true });

  onEvent({ type: "transcribe-start" });
  const { words: rawWords } = await provider.transcribe({ srcPath: sourceDest, language, model: whisperModel, signal });

  const quality = checkTranscriptQuality(rawWords);
  if (!quality.ok) return { ok: false, error: quality.error };

  const words = cleanTranscriptWords(rawWords);
  writeFileSync(join(sourceDir, "transcript.json"), JSON.stringify(words, null, 2));
  onEvent({ type: "transcribe-done", wordCount: words.length, garbageRatio: quality.garbageRatio });

  const { scenes: cuts } = await runAudioSceneCutter({ projectDir: projectAbs, words, model, onEvent, signal });

  // Build scenes.json in the exact shape content-planner.mjs produces — narration is
  // the SAME punctuated text the LLM wrote into master_content.md below, so the
  // "narration must be a verbatim substring of master_content.md" convention
  // (caption-chunks.mjs's alignment, /caption route) holds by construction.
  const masterContent = cuts.map((c) => c.narration).join("\n\n");
  writeFileSync(join(projectAbs, "master_content.md"), masterContent);

  const scenesJson = {
    master_content: "master_content.md",
    platform,
    total_estimated_duration: Math.round(cuts.reduce((sum, c) => sum + (words[c.word_end - 1].end - words[c.word_start].start), 0)),
    scenes: cuts.map((c) => ({
      sceneId: c.sceneId,
      narration: c.narration,
      meaning: c.meaning,
      estimated_duration: Math.round((words[c.word_end - 1].end - words[c.word_start].start) * 10) / 10,
      mood_hint: c.mood_hint,
      is_hook: c.is_hook,
    })),
  };
  writeFileSync(join(projectAbs, "scenes.json"), JSON.stringify(scenesJson, null, 2));
  onEvent({ type: "scene-audio-cut-start", sceneCount: cuts.length });

  const audioDir = join(projectAbs, "assets", "audio");
  mkdirSync(audioDir, { recursive: true });

  async function getSceneAudio(scene) {
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    const cut = cuts.find((c) => c.sceneId === scene.sceneId);
    const sceneWords = words.slice(cut.word_start, cut.word_end);
    if (!sceneWords.length) return null;

    const dest = join(audioDir, `${scene.sceneId}_vo.mp3`);
    const startSec = sceneWords[0].start;
    const naturalEndSec = sceneWords.at(-1).end;

    if (!existsSync(dest)) {
      try {
        await cutAudioClip({ srcPath: sourceDest, destPath: dest, startSec, endSec: naturalEndSec + CLIP_TRAILING_PAD_SEC, signal });
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        onEvent({ type: "scene-audio-cut-error", sceneId: scene.sceneId, error: err.message });
        return null;
      }
      onEvent({ type: "scene-audio-cut-done", sceneId: scene.sceneId });
    } else {
      onEvent({ type: "scene-skip", sceneId: scene.sceneId });
    }

    // Rebase to scene-relative timestamps (0-based) — matches the convention every
    // TTS provider already produces (see scene-timing-assembler.mjs's consumers).
    const wordTimestamps = sceneWords.map((w) => ({ word: w.word, start: w.start - startSec, end: w.end - startSec }));
    // Same sidecar file generate-audio.mjs writes per scene (see its
    // generateVoiceover's skip-on-rerun path) — without this, a later "Chạy lại
    // audio" click on this project (Pipeline.jsx's own retry button, which runs the
    // TTS path) would find the mp3 already on disk but no matching _timing.json,
    // and misreport every scene as failed instead of correctly skipping them.
    writeFileSync(join(audioDir, `${scene.sceneId}_timing.json`), JSON.stringify(wordTimestamps, null, 2));
    return { wordTimestamps, voDuration: naturalEndSec - startSec };
  }

  return assembleScenesWithTiming(projectAbs, scenesJson, getSceneAudio, { musicTrackOverride: musicTrack, musicVolume, onEvent });
}
