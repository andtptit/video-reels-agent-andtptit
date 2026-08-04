/**
 * Audio generation pipeline — extracted from scripts/generate-audio.mjs so
 * routes.mjs (`POST /projects/:id/audio`) and the CLI can share one implementation.
 * Behavior is unchanged from the original script; only console.log calls became
 * onEvent(...) calls so callers (CLI printer vs job-status/SSE) can format them
 * however they need.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync } from "fs";
import { join, resolve } from "path";
import * as elevenlabs from "../providers/tts/elevenlabs.mjs";
import * as edgeTts from "../providers/tts/edge-tts.mjs";
import { CancelledError } from "../jobs/cancel-registry.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const TTS_PROVIDERS = { elevenlabs, "edge-tts": edgeTts };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TTS_RETRIES = 2; // total 3 attempts per scene before giving up — matches dashscope.mjs's convention

function findWordTime(wordTimestamps, target) {
  const norm = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const t = norm(target);
  const single = wordTimestamps.find((w) => norm(w.word) === t);
  if (single) return single;
  const firstWord = t.split(" ")[0];
  return wordTimestamps.find((w) => norm(w.word) === firstWord);
}

function resolveTimingAnchors(brief = "", wordTimestamps = [], onEvent) {
  if (!wordTimestamps.length) return {};
  const anchors = {};
  const patterns = [
    /khi từ ['"](.+?)['"] được nói/gi,
    /khi nói ['"](.+?)['"]/gi,
    /at word ['"](.+?)['"]/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(brief)) !== null) {
      const target = match[1];
      const found = findWordTime(wordTimestamps, target);
      if (found) anchors[target] = found.start;
      else onEvent({ type: "anchor-not-found", target });
    }
  }
  return anchors;
}

const MOOD_TO_MUSIC = {
  explosive: "upbeat-tech", snappy: "upbeat-tech",
  cinematic: "cinematic-dark", fluid: "fluid-ambient", technical: "technical-pulse",
};

function selectMusic(plans) {
  const dominant = plans.plans?.[0]?.mood ?? "fluid";
  return MOOD_TO_MUSIC[dominant] ?? "fluid-ambient";
}

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
export async function runGenerateAudio(projectDir, { ttsProvider: providerId = process.env.TTS_PROVIDER || "elevenlabs", ttsRate, ttsVoice, musicTrack: musicTrackOverride, musicVolume, onEvent = () => {}, signal } = {}) {
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

  const output = { ...raw, scenes: [] };
  let cursor = 0;
  // Scenes whose TTS call threw (network hiccup, provider error, etc) — generateVoiceover
  // swallows the error and returns null so 1 bad scene doesn't kill the whole batch, but
  // that must not mean the failure vanishes: confirmed live (user report) a project shipped
  // with 2 scenes silently missing both audio AND captions (word_timestamps stays `[]`,
  // so the "sub" style's caption chunker has nothing to chunk) while job-status still
  // showed "audio: done". Collected here so the caller can fail the whole step loudly.
  const failedSceneIds = [];

  // Buffer between vo_duration and scene_duration — combined with root-composer's
  // 0.3s crossfade overlap, the actual silent gap between scenes' voiceovers is
  // (SCENE_DURATION_BUFFER - 0.3). Was 0.5 (→ 0.2s gap); bumped to 0.7 (→ 0.4s gap)
  // per user request — the 0.2s gap technically existed but wasn't perceptible since
  // bg-music never pauses through it, masking the silence.
  const SCENE_DURATION_BUFFER = 0.7;

  for (const scene of plans.scenes) {
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    const result = await generateVoiceover(scene);
    if (scene.narration && !result) failedSceneIds.push(scene.sceneId);
    const wordTimestamps = result?.wordTimestamps ?? null;
    const voDuration = result?.voDuration ?? scene.estimated_duration ?? scene.duration ?? 5;
    const sceneDuration = Math.round((voDuration + SCENE_DURATION_BUFFER) * 100) / 100;

    const timingAnchors = resolveTimingAnchors(scene.visual_brief ?? scene.creative_brief ?? "", wordTimestamps ?? [], onEvent);

    output.scenes.push({
      ...scene,
      _audio: {
        // `result` truthy means generateVoiceover() either just synthesized the
        // file or found it already on disk from a prior run — both mean the mp3
        // genuinely exists. Gating on `scene.narration` ALONE (the old code) was a
        // real bug found live: when TTS failed transiently (edge-tts "Stream
        // closed"), this field still claimed a path that was never written, so
        // every downstream consumer (root-composer, scene-writer) trusted a
        // phantom file — hyperframes lint only caught it much later as
        // `audio_src_not_found` on the FINAL rendered index.html, after wasting a
        // root-composer LLM retry loop chasing what looked like a missing-<audio>-
        // tag bug but was actually "the file this tag correctly doesn't exist for
        // doesn't exist either."
        voiceover: scene.narration && result ? `assets/audio/${scene.sceneId}_vo.mp3` : null,
        voiceover_start: cursor,
        vo_duration: voDuration,
        scene_duration: sceneDuration,
        word_timestamps: wordTimestamps ?? [],
        timing_anchors: timingAnchors,
      },
    });

    onEvent({ type: "scene-done", sceneId: scene.sceneId, voDuration, sceneDuration });

    cursor += sceneDuration;
    if (scene.narration) await sleep(800);
  }

  // Confirmed live (user report): assets/music/ shipped EMPTY in this workspace —
  // setup-music-library.mjs needs ElevenLabs Sound Generation, which the Free plan
  // blocks (401 missing_permissions, see plan.md Phase 0). Every past render in this
  // workspace silently had NO background music at all: `music_track` pointed at a
  // mood-specific file that never existed, so the copy step below no-opped and
  // root-composer just omitted the track entirely — no error anywhere. User has since
  // manually added a single catch-all `assets/music/default.mp3` (not the 4 mood-
  // specific names) — fall back to it whenever the mood-specific file is missing,
  // rather than silently going music-less again.
  // `musicTrackOverride` (from UI, see Pipeline.jsx) skips the mood auto-pick
  // entirely — user explicitly chose a track, don't second-guess it.
  let musicTrack = musicTrackOverride || selectMusic(plans);
  if (!existsSync(join(ROOT, "assets", "music", `${musicTrack}.mp3`)) && existsSync(join(ROOT, "assets", "music", "default.mp3"))) {
    onEvent({ type: "music-fallback", requested: musicTrack, using: "default" });
    musicTrack = "default";
  }
  output._audio = { music_track: `assets/music/${musicTrack}.mp3`, music_volume: musicVolume ?? raw.music?.volume ?? 0.2 };
  onEvent({ type: "music-selected", track: musicTrack });

  const sfxNeeded = new Set(plans.scenes.flatMap((s) => (s.sfx_picks ?? []).map((p) => p.id)));
  if (sfxNeeded.size) {
    mkdirSync(join(projectAbs, "assets", "sfx"), { recursive: true });
    for (const id of sfxNeeded) {
      const src = join(ROOT, "assets", "sfx", `${id}.mp3`);
      const dst = join(projectAbs, "assets", "sfx", `${id}.mp3`);
      if (existsSync(src) && !existsSync(dst)) {
        copyFileSync(src, dst);
        onEvent({ type: "sfx-copied", id });
      } else if (!existsSync(src)) {
        onEvent({ type: "sfx-missing", id });
      }
    }
  }

  mkdirSync(join(projectAbs, "assets", "music"), { recursive: true });
  const musicSrc = join(ROOT, "assets", "music", `${musicTrack}.mp3`);
  const musicDst = join(projectAbs, "assets", "music", `${musicTrack}.mp3`);
  if (existsSync(musicSrc) && !existsSync(musicDst)) {
    copyFileSync(musicSrc, musicDst);
    onEvent({ type: "music-copied", track: musicTrack });
  }

  const outFile = join(projectAbs, "scenes-with-timing.json");
  writeFileSync(outFile, JSON.stringify(output, null, 2));

  const totalDuration = output.scenes.reduce((sum, s) => sum + (s._audio?.scene_duration ?? 0), 0);
  onEvent({ type: "done", totalDuration, outFile, failedSceneIds });

  // scenes-with-timing.json is already written above even on partial failure — so a
  // retry (POST /audio again) is cheap: generateVoiceover's existsSync(dest) check
  // skips every scene that already has real audio, only retrying the ones that
  // failed. Surfacing this as `ok: false` (runStep/job-status.mjs treats that the
  // same as a thrown error) makes the "audio" step show "error" instead of silently
  // "done" with 2 scenes missing voice + captions — matches the same convention
  // scene-writer/render already use for "resolved but actually failed" results.
  if (failedSceneIds.length) {
    return {
      ...output,
      ok: false,
      error: `TTS thất bại cho scene: ${failedSceneIds.join(", ")} — không có audio/word-timestamps thật (không có phụ đề). Chạy lại bước Audio để retry (các scene đã xong sẽ được bỏ qua, không tốn phí lại).`,
      failedSceneIds,
    };
  }

  return output;
}
