/**
 * Deterministic (NO LLM call) root `index.html` writer for template "hook" — replaces
 * agents/root-composer.mjs entirely for this format. root-composer.mjs exists to
 * solve crossfade math across N scenes + a voiceover track per scene; this format is
 * ALWAYS exactly 1 scene (the whole video) with no voiceover at all, so there's
 * nothing left for an LLM to decide — just wire 1 scene div + 1 music track, no
 * atmosphere layer (that's DESIGN.md's "motion"-only neon palette, unrelated here,
 * same reasoning already applied in video-planner.mjs for template "sub").
 *
 * Music copy-into-project logic mirrors pipeline/generate-audio.mjs's own block
 * (mood-file-missing → "default.mp3" fallback) rather than reinventing it.
 */
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from "fs";
import { join, resolve } from "path";
import { dimensionsForFormat } from "../lib/canvas.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * @param {object} params
 * @param {string} params.projectDir
 * @param {string} params.format - "9:16" | "16:9"
 * @param {number} params.videoDurationSec
 * @param {string} [params.musicTrack] - library file id (no ".mp3"), e.g. "default"
 * @param {number} [params.musicVolume] - 0-1
 * @param {(event: object) => void} [params.onEvent]
 */
export function buildHookRoot({ projectDir, format, videoDurationSec, musicTrack, musicVolume, onEvent }) {
  const { width, height } = dimensionsForFormat(format);

  let track = musicTrack || "default";
  if (!existsSync(join(ROOT, "assets", "music", `${track}.mp3`)) && existsSync(join(ROOT, "assets", "music", "default.mp3"))) {
    onEvent?.({ type: "music-fallback", requested: track, using: "default" });
    track = "default";
  }
  const musicSrc = join(ROOT, "assets", "music", `${track}.mp3`);
  const musicRelPath = `assets/music/${track}.mp3`;
  const hasMusic = existsSync(musicSrc);
  if (hasMusic) {
    mkdirSync(join(projectDir, "assets", "music"), { recursive: true });
    const musicDst = join(projectDir, musicRelPath);
    if (!existsSync(musicDst)) copyFileSync(musicSrc, musicDst);
    onEvent?.({ type: "music-copied", track });
  }
  const volume = musicVolume ?? 0.18;

  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>hook</title>
    <style>
      body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${videoDurationSec}" data-width="${width}" data-height="${height}">
      ${hasMusic ? `<audio id="bg-music" class="clip" data-start="0" data-duration="${videoDurationSec}" data-track-index="20" data-volume="${volume}" src="${musicRelPath}"></audio>` : ""}
      <div id="scene-01" class="clip" data-composition-id="scene-01" data-composition-src="compositions/scene_01.html" data-start="0" data-duration="${videoDurationSec}" data-track-index="10" data-width="${width}" data-height="${height}"></div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines['main'] = tl;
    </script>
  </body>
</html>
`;

  writeFileSync(join(projectDir, "index.html"), html);
  onEvent?.({ type: "write", outPath: "index.html" });

  return { ok: true, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 } };
}
