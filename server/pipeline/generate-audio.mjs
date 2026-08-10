/**
 * Audio generation pipeline — extracted from scripts/generate-audio.mjs so
 * routes.mjs (`POST /projects/:id/audio`) and the CLI can share one implementation.
 * Behavior is unchanged from the original script; only console.log calls became
 * onEvent(...) calls so callers (CLI printer vs job-status/SSE) can format them
 * however they need.
 *
 * The "assemble scenes-with-timing.json" tail (buffer math, `_audio` shape, music/SFX
 * copy, failedSceneIds convention) lives in scene-timing-assembler.mjs, shared with
 * server/pipeline/audio-import.mjs's ffmpeg-cut-based producer — this file only owns
 * what's genuinely TTS-specific: provider selection, per-scene synthesis + retries,
 * and the skip-if-already-on-disk rerun convention.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import * as elevenlabs from "../providers/tts/elevenlabs.mjs";
import * as edgeTts from "../providers/tts/edge-tts.mjs";
import { CancelledError } from "../jobs/cancel-registry.mjs";
import { assembleScenesWithTiming } from "./scene-timing-assembler.mjs";

const TTS_PROVIDERS = { elevenlabs, "edge-tts": edgeTts };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TTS_RETRIES = 2; // total 3 attempts per scene before giving up — matches dashscope.mjs's convention

/**
 * @param {string} projectDir
 * @param {{ ttsProvider?: string, ttsRate?: number, ttsVoice?: string, musicTrack?: string,
 *   musicVolume?: number, onEvent?: (e: object) => void }} [opts]
 *   ttsRate/ttsVoice only affect edge-tts (elevenlabs.mjs's synthesize() has no
 *   rate/voiceId params in the same shape — passing them through is harmless, just
 *   unused, so callers don't need to branch on provider first). `musicTrack` (a
 *   library file id, e.g. "default" — no ".mp3") overrides the mood-based auto-pick
 *   entirely when given; `musicVolume` is 0-1 (UI sends a 0-100 percent, divided
 *   before it gets here — see routes.mjs).
 */
export async function runGenerateAudio(projectDir, { ttsProvider: providerId = process.env.TTS_PROVIDER || "elevenlabs", ttsRate, ttsVoice, musicTrack, musicVolume, onEvent = () => {}, signal } = {}) {
  const ttsProvider = TTS_PROVIDERS[providerId];
  if (!ttsProvider) {
    throw new Error(`Unknown TTS_PROVIDER "${providerId}". Valid: ${Object.keys(TTS_PROVIDERS).join(", ")}`);
  }
  if (providerId === "elevenlabs" && !process.env.ELEVENLABS_API_KEY) {
    throw new Error("Missing ELEVENLABS_API_KEY (or set ttsProvider: 'edge-tts')");
  }

  const projectAbs = resolve(projectDir);
  const inputFile = existsSync(join(projectAbs, "scenes.json"))
    ? join(projectAbs, "scenes.json")
    : join(projectAbs, "plans.json");

  if (!existsSync(inputFile)) {
    throw new Error("scenes.json (hoặc plans.json) not found — chạy content-planner trước.");
  }

  const raw = JSON.parse(readFileSync(inputFile, "utf-8"));
  const plans = { ...raw, scenes: raw.scenes ?? raw.plans ?? [] };

  const audioDir = join(projectAbs, "assets", "audio");
  mkdirSync(audioDir, { recursive: true });

  async function generateVoiceover(scene) {
    if (!scene.narration) return null;

    const dest = join(audioDir, `${scene.sceneId}_vo.mp3`);
    if (existsSync(dest)) {
      onEvent({ type: "scene-skip", sceneId: scene.sceneId });
      const timingFile = join(audioDir, `${scene.sceneId}_timing.json`);
      if (!existsSync(timingFile)) return null;
      // Found live (re-running /audio on a project with some scenes already done):
      // `<sceneId>_timing.json` on disk IS the raw wordTimestamps array (that's
      // literally what gets written a few lines below on a fresh synth) — this
      // used to `return` that array directly, but every caller expects
      // `{wordTimestamps, voDuration}`. `array.wordTimestamps` is `undefined`, so
      // every skip silently reset `word_timestamps` to `[]` and `voDuration` to a
      // guess (`scene.estimated_duration`) in the REBUILT scenes-with-timing.json —
      // even though the real per-word data was sitting right there on disk. Only
      // showed up because a scene with correct data from a PRIOR run got its
      // caption/timing silently degraded on the NEXT run's skip path — reconstruct
      // both fields properly instead of returning the array bare.
      const wordTimestamps = JSON.parse(readFileSync(timingFile, "utf-8"));
      const voDuration = wordTimestamps.length ? Math.max(...wordTimestamps.map((w) => w.end)) : null;
      if (!voDuration) return null; // empty/malformed timing file — treat like a failed scene, not a silent guess
      return { wordTimestamps, voDuration };
    }

    onEvent({ type: "scene-start", sceneId: scene.sceneId, narration: scene.narration });

    // Retry transient failures — confirmed live (user report) that edge-tts's
    // unofficial WebSocket API occasionally drops mid-synthesis ("Stream closed
    // before the synthesis completed (no turn.end received)") for no reason tied to
    // the text itself (other scenes with similar narration succeeded on the first
    // try). Same isTransient/backoff shape as chatCompletion (dashscope.mjs) — retry
    // blindly (edge-tts throws plain Error, no error code to classify transient vs
    // permanent) since the cost of retrying a genuinely permanent failure is just a
    // few wasted seconds before it fails anyway, vs. previously killing an entire
    // unattended "Chạy toàn bộ pipeline" run on one network hiccup.
    let result;
    let lastErr;
    for (let attempt = 0; attempt <= TTS_RETRIES; attempt++) {
      try {
        result = await ttsProvider.synthesize({
          text: scene.narration,
          destPath: dest,
          signal,
          ...(ttsRate ? { rate: ttsRate } : {}),
          ...(ttsVoice ? { voiceId: ttsVoice } : {}),
        });
        lastErr = null;
        break;
      } catch (err) {
        // A deliberate Huỷ must propagate immediately, not get folded into the
        // per-scene retry loop (which exists for genuine transient hiccups) nor
        // swallowed into `failedSceneIds` below like an ordinary TTS failure would
        // be — that would misreport a cancel as "audio thất bại" and, worse, keep
        // synthesizing the REMAINING scenes after the user asked to stop.
        if (err instanceof CancelledError || signal?.aborted) throw err instanceof CancelledError ? err : new CancelledError();
        lastErr = err;
        if (attempt < TTS_RETRIES) {
          onEvent({ type: "scene-retry", sceneId: scene.sceneId, attempt: attempt + 1, error: err.message });
          await sleep(1000 * 2 ** attempt); // 1s, 2s
        }
      }
    }
    if (lastErr) {
      onEvent({ type: "scene-error", sceneId: scene.sceneId, error: lastErr.message });
      return null;
    }

    const { wordTimestamps, voDuration, audioBytes } = result;
    writeFileSync(join(audioDir, `${scene.sceneId}_timing.json`), JSON.stringify(wordTimestamps, null, 2));
    onEvent({ type: "scene-tts-done", sceneId: scene.sceneId, voDuration, audioBytes });
    return { wordTimestamps, voDuration };
  }

  onEvent({ type: "start", provider: providerId, sceneCount: plans.scenes.length });

  async function getSceneAudio(scene) {
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    const result = await generateVoiceover(scene);
    if (scene.narration) await sleep(800); // pace TTS calls — unrelated to the assembler's own bookkeeping
    return result;
  }

  return assembleScenesWithTiming(projectDir, plans, getSceneAudio, { musicTrackOverride: musicTrack, musicVolume, onEvent });
}
