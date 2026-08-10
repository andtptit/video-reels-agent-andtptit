/**
 * Assembles `scenes-with-timing.json` from a list of scenes plus a per-scene audio
 * producer — extracted out of generate-audio.mjs so its TTS-specific half
 * (`generateVoiceover`: provider selection, retries, TTS-only skip-on-rerun) can stay
 * there while this half (buffer/cursor math, the `_audio` object shape, music/SFX
 * selection+copy, the `voiceover: null` gating convention, `failedSceneIds` →
 * `{ok:false}`) is shared verbatim with server/pipeline/audio-import.mjs's
 * ffmpeg-cut-based producer. Both callers only ever need to resolve one
 * `{wordTimestamps, voDuration}` tuple per scene — how that tuple was produced
 * (TTS synthesis vs. cutting a real uploaded audio file) is the only thing that
 * differs between them, and this file must never need to know which.
 */
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..", "..");

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

// Buffer between vo_duration and scene_duration — combined with root-composer's 0.3s
// crossfade overlap, the actual silent gap between scenes' voiceovers is
// (SCENE_DURATION_BUFFER - 0.3) — see generate-audio.mjs's original comment for the
// 0.5→0.7 history.
const SCENE_DURATION_BUFFER = 0.7;

/**
 * @param {string} projectDir
 * @param {object} plans - `{scenes: [...], ...}` (scenes.json shape)
 * @param {(scene: object) => Promise<{wordTimestamps: object[], voDuration: number} | null>} getSceneAudio -
 *   resolves one scene's real audio; return `null` for a scene that has narration but
 *   no audio could be produced (counted into `failedSceneIds`). The audio file itself
 *   must already exist on disk at `assets/audio/<sceneId>_vo.mp3` by the time this
 *   resolves — this function only records that path, it never writes the audio.
 * @param {{musicTrackOverride?: string, musicVolume?: number, onEvent?: (e: object) => void}} [opts]
 */
export async function assembleScenesWithTiming(projectDir, plans, getSceneAudio, { musicTrackOverride, musicVolume, onEvent = () => {} } = {}) {
  const projectAbs = resolve(projectDir);
  const output = { ...plans, scenes: [] };
  let cursor = 0;
  // See generate-audio.mjs's original comment: a scene whose audio producer fails
  // must not vanish silently — job-status.mjs's runStep treats a resolved `{ok:false}`
  // as an error, so the whole step shows "error" instead of a false "done" with
  // scenes missing voice/captions.
  const failedSceneIds = [];

  for (const scene of plans.scenes) {
    const result = await getSceneAudio(scene);
    if (scene.narration && !result) failedSceneIds.push(scene.sceneId);
    const wordTimestamps = result?.wordTimestamps ?? null;
    const voDuration = result?.voDuration ?? scene.estimated_duration ?? scene.duration ?? 5;
    const sceneDuration = Math.round((voDuration + SCENE_DURATION_BUFFER) * 100) / 100;

    const timingAnchors = resolveTimingAnchors(scene.visual_brief ?? scene.creative_brief ?? "", wordTimestamps ?? [], onEvent);

    output.scenes.push({
      ...scene,
      _audio: {
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
  }

  // Confirmed live (user report): assets/music/ shipped EMPTY in this workspace —
  // fall back to the single catch-all assets/music/default.mp3 whenever the
  // mood-specific file is missing, rather than silently going music-less.
  // `musicTrackOverride` (from UI) skips the mood auto-pick entirely.
  let musicTrack = musicTrackOverride || selectMusic(plans);
  if (!existsSync(join(ROOT, "assets", "music", `${musicTrack}.mp3`)) && existsSync(join(ROOT, "assets", "music", "default.mp3"))) {
    onEvent({ type: "music-fallback", requested: musicTrack, using: "default" });
    musicTrack = "default";
  }
  output._audio = { music_track: `assets/music/${musicTrack}.mp3`, music_volume: musicVolume ?? plans.music?.volume ?? 0.2 };
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

  // scenes-with-timing.json is already written above even on partial failure, so a
  // retry is cheap as long as the caller's getSceneAudio skips scenes that already
  // have real audio on disk (both generate-audio.mjs and audio-import.mjs do).
  if (failedSceneIds.length) {
    return {
      ...output,
      ok: false,
      error: `Không tạo được audio thật cho scene: ${failedSceneIds.join(", ")} — không có audio/word-timestamps thật (không có phụ đề). Chạy lại bước này để retry (các scene đã xong sẽ được bỏ qua, không tốn phí lại).`,
      failedSceneIds,
    };
  }

  return output;
}
