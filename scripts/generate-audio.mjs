#!/usr/bin/env node
/**
 * Audio Generation Pipeline
 *
 * Đọc scenes.json từ project folder → TTS per scene → scenes-with-timing.json
 * Backward compat: nếu không có scenes.json thì đọc plans.json
 *
 * Usage:
 *   node --env-file=.env scripts/generate-audio.mjs <project-path>
 *
 * Expects: <project-path>/scenes.json  (hoặc plans.json)
 * Outputs: <project-path>/scenes-with-timing.json
 *          <project-path>/assets/audio/*.mp3   (voiceover + timing JSON)
 *          <project-path>/assets/sfx/*.mp3     (copied from workspace library)
 *          <project-path>/assets/music/*.mp3   (copied from workspace library)
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync } from "fs";
import { join, resolve } from "path";

const ROOT = join(import.meta.dirname, "..");
const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) { console.error("Missing ELEVENLABS_API_KEY in .env"); process.exit(1); }

const [projectPath] = process.argv.slice(2);
if (!projectPath) {
  console.error("Usage: node --env-file=.env scripts/generate-audio.mjs <project-path>");
  process.exit(1);
}

const projectAbs = resolve(ROOT, projectPath);

// Ưu tiên scenes.json (workflow mới), fallback plans.json (backward compat)
const inputFile = existsSync(join(projectAbs, "scenes.json"))
  ? join(projectAbs, "scenes.json")
  : join(projectAbs, "plans.json");

if (!existsSync(inputFile)) {
  console.error(`scenes.json (hoặc plans.json) not found in ${projectPath}/`);
  console.error("Chạy /content-planner trước để tạo scenes.json.");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(inputFile, "utf-8"));
// Normalize: hỗ trợ cả { scenes: [] } và { plans: [] }
const plans = { ...raw, scenes: raw.scenes ?? raw.plans ?? [] };

const audioDir = join(projectAbs, "assets", "audio");
mkdirSync(audioDir, { recursive: true });

// eleven_turbo_v2_5 — hỗ trợ tiếng Việt, nhanh hơn multilingual
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "3VnrjnYrskPMDsapTr8X";
const MODEL_ID = "eleven_turbo_v2_5";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractWordTimestamps(chars, times) {
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

function findWordTime(wordTimestamps, target) {
  const norm = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const t = norm(target);
  // Thử match đơn từ trước
  const single = wordTimestamps.find((w) => norm(w.word) === t);
  if (single) return single;
  // Thử match từ đầu của cụm từ nhiều tiếng (vd: "kịch bản" → match "kịch")
  const firstWord = t.split(" ")[0];
  return wordTimestamps.find((w) => norm(w.word) === firstWord);
}

function resolveTimingAnchors(brief = "", wordTimestamps = []) {
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
      const found  = findWordTime(wordTimestamps, target);
      if (found) anchors[target] = found.start;
      else console.log(`  warn  anchor '${target}' not found in timestamps`);
    }
  }
  return anchors;
}

// ─── TTS per scene ──────────────────────────────────────────────────────────

async function generateVoiceover(scene) {
  if (!scene.narration) return null;

  const dest = join(audioDir, `${scene.sceneId}_vo.mp3`);
  if (existsSync(dest)) {
    console.log(`  skip  ${scene.sceneId} voiceover (already exists)`);
    const timingFile = join(audioDir, `${scene.sceneId}_timing.json`);
    return existsSync(timingFile) ? JSON.parse(readFileSync(timingFile, "utf-8")) : null;
  }

  process.stdout.write(`  tts   ${scene.sceneId} "${scene.narration.slice(0, 45)}..." `);

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps`,
    {
      method: "POST",
      headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: scene.narration,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  if (!res.ok) { console.error(`FAILED (${res.status}): ${await res.text()}`); return null; }

  const data = await res.json();
  const audioBuf = Buffer.from(data.audio_base64, "base64");
  writeFileSync(dest, audioBuf);

  const { characters, character_start_times_seconds } = data.alignment;
  const wordTimestamps = extractWordTimestamps(characters, character_start_times_seconds);
  writeFileSync(join(audioDir, `${scene.sceneId}_timing.json`), JSON.stringify(wordTimestamps, null, 2));

  const voDuration = character_start_times_seconds.at(-1) ?? 0;
  console.log(`ok (~${voDuration.toFixed(2)}s, ${(audioBuf.length / 1024).toFixed(0)} KB)`);
  return { wordTimestamps, voDuration };
}

// ─── Music selection ─────────────────────────────────────────────────────────

const MOOD_TO_MUSIC = {
  explosive: "upbeat-tech", snappy: "upbeat-tech",
  cinematic: "cinematic-dark", fluid: "fluid-ambient", technical: "technical-pulse",
};

function selectMusic(plans) {
  const dominant = plans.plans?.[0]?.mood ?? "fluid";
  return MOOD_TO_MUSIC[dominant] ?? "fluid-ambient";
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log(`\nAudio generation → ${projectPath}/\n`);
console.log(`  model  ${MODEL_ID}\n  voice  ${VOICE_ID}\n`);

const output = { ...raw, scenes: [] };
let cursor = 0;

for (const scene of plans.scenes) {
  process.stdout.write(`\n[${scene.sceneId}]\n`);

  const result        = await generateVoiceover(scene);
  const wordTimestamps = result?.wordTimestamps ?? null;
  const voDuration     = result?.voDuration     ?? scene.estimated_duration ?? scene.duration ?? 5;
  const sceneDuration  = Math.round((voDuration + 0.5) * 100) / 100;

  const timingAnchors = resolveTimingAnchors(
    scene.visual_brief ?? scene.creative_brief ?? "",
    wordTimestamps ?? []
  );
  if (Object.keys(timingAnchors).length) console.log(`  anchors: ${JSON.stringify(timingAnchors)}`);
  console.log(`  duration: ${voDuration.toFixed(2)}s VO → ${sceneDuration}s scene`);

  output.scenes.push({
    ...scene,
    _audio: {
      voiceover:        scene.narration ? `assets/audio/${scene.sceneId}_vo.mp3` : null,
      voiceover_start:  cursor,
      vo_duration:      voDuration,
      scene_duration:   sceneDuration,
      word_timestamps:  wordTimestamps ?? [],
      timing_anchors:   timingAnchors,
    },
  });

  cursor += sceneDuration;
  if (scene.narration) await sleep(800);
}

// Music
const musicTrack = selectMusic(plans);
output._audio = { music_track: `assets/music/${musicTrack}.mp3`, music_volume: raw.music?.volume ?? 0.18 };
console.log(`\n  music  → ${musicTrack}.mp3`);

// Copy SFX từ library vào project
const sfxNeeded = new Set(plans.scenes.flatMap((s) => (s.sfx_picks ?? []).map((p) => p.id)));
if (sfxNeeded.size) {
  mkdirSync(join(projectAbs, "assets", "sfx"), { recursive: true });
  for (const id of sfxNeeded) {
    const src = join(ROOT, "assets", "sfx", `${id}.mp3`);
    const dst = join(projectAbs, "assets", "sfx", `${id}.mp3`);
    if (existsSync(src) && !existsSync(dst)) { copyFileSync(src, dst); console.log(`  copy  assets/sfx/${id}.mp3`); }
    else if (!existsSync(src)) console.warn(`  warn  SFX not in library: ${id}`);
  }
}

// Copy music từ library vào project
mkdirSync(join(projectAbs, "assets", "music"), { recursive: true });
const musicSrc = join(ROOT, "assets", "music", `${musicTrack}.mp3`);
const musicDst = join(projectAbs, "assets", "music", `${musicTrack}.mp3`);

if (existsSync(musicSrc) && !existsSync(musicDst)) { copyFileSync(musicSrc, musicDst); console.log(`  copy  assets/music/${musicTrack}.mp3`); }

// Save
const outFile = join(projectAbs, "scenes-with-timing.json");
writeFileSync(outFile, JSON.stringify(output, null, 2));

const totalDuration = output.scenes.reduce((sum, s) => sum + (s._audio?.scene_duration ?? 0), 0);
console.log(`\nSaved: ${projectPath}/scenes-with-timing.json`);
console.log(`Total duration: ${totalDuration.toFixed(1)}s`);
console.log("Next: /video-planner → đọc scenes-with-timing.json → viết video-plan.json\n");
