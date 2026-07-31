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

const ROOT = resolve(import.meta.dirname, "..", "..");
const TTS_PROVIDERS = { elevenlabs, "edge-tts": edgeTts };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
 * @param {{ ttsProvider?: string, onEvent?: (e: object) => void }} [opts]
 */
export async function runGenerateAudio(projectDir, { ttsProvider: providerId = process.env.TTS_PROVIDER || "elevenlabs", onEvent = () => {} } = {}) {
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
      return existsSync(timingFile) ? JSON.parse(readFileSync(timingFile, "utf-8")) : null;
    }

    onEvent({ type: "scene-start", sceneId: scene.sceneId, narration: scene.narration });

    let result;
    try {
      result = await ttsProvider.synthesize({ text: scene.narration, destPath: dest });
    } catch (err) {
      onEvent({ type: "scene-error", sceneId: scene.sceneId, error: err.message });
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

  for (const scene of plans.scenes) {
    const result = await generateVoiceover(scene);
    const wordTimestamps = result?.wordTimestamps ?? null;
    const voDuration = result?.voDuration ?? scene.estimated_duration ?? scene.duration ?? 5;
    const sceneDuration = Math.round((voDuration + 0.5) * 100) / 100;

    const timingAnchors = resolveTimingAnchors(scene.visual_brief ?? scene.creative_brief ?? "", wordTimestamps ?? [], onEvent);

    output.scenes.push({
      ...scene,
      _audio: {
        voiceover: scene.narration ? `assets/audio/${scene.sceneId}_vo.mp3` : null,
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

  const musicTrack = selectMusic(plans);
  output._audio = { music_track: `assets/music/${musicTrack}.mp3`, music_volume: raw.music?.volume ?? 0.18 };
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
  onEvent({ type: "done", totalDuration, outFile });

  return output;
}
