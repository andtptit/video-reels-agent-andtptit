/**
 * Deterministic (NO LLM call) video-plan builder for the "Đọc Caption" tab — mirrors
 * pipeline/build-footage-plan.mjs's role for template "footage": nothing here needs a
 * model's judgment, it's just assembling already-known values into video-plan.json.
 *
 * Unlike every other template, this format has no scenes-with-timing.json to read
 * from (no audio/TTS step exists in this tab's pipeline at all — see plan.md) — the
 * single scene's target duration comes straight from the hook-profile's own
 * `videoDurationSec`, and its content comes from `hook-plan.json` (already written by
 * hook-content-writer.mjs).
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * @param {object} params
 * @param {string} params.projectDir
 * @param {string} params.format - "9:16" | "16:9"
 * @param {number} params.videoDurationSec
 * @param {string} params.ctaText
 * @param {string} params.highlightColor
 * @param {number} [params.blurPercent] - 0-100, see templates/hook-style.mjs
 * @param {string} [params.footageFolder] - absolute path override; falsy = shared
 *   assets/footage-library/ (see lib/footage-library.mjs's FOOTAGE_LIBRARY_DIR default)
 * @param {object} params.footageConfig - same shape as "footage" template's own
 *   (minClipsPerScene, maxClipsPerScene, minClipSeconds, maxClipSeconds, flipEnabled,
 *   speedEnabled, speedMin, speedMax, fontFamily) — CODE-owned, persisted as-is.
 * @param {string} [params.musicTrack]
 * @param {number} [params.musicVolume]
 * @param {(event: object) => void} [params.onEvent]
 */
export function buildHookVideoPlan({
  projectDir,
  format,
  videoDurationSec,
  ctaText,
  highlightColor,
  blurPercent,
  footageFolder,
  footageConfig,
  musicTrack,
  musicVolume,
  onEvent,
}) {
  const hookPlan = JSON.parse(readFileSync(join(projectDir, "hook-plan.json"), "utf-8"));

  const plan = {
    template: "hook",
    format,
    total_duration: videoDurationSec,
    scenes: [{ sceneId: "scene_01", duration: videoDurationSec }],
    footageConfig,
    footageFolder,
    hookContent: {
      hook: hookPlan.hook,
      highlightWord: hookPlan.highlightWord,
      count: hookPlan.count,
      topic: hookPlan.topic,
    },
    ctaText,
    highlightColor,
    blurPercent,
    musicTrack,
    musicVolume,
  };

  writeFileSync(join(projectDir, "video-plan.json"), JSON.stringify(plan, null, 2));
  onEvent?.({ type: "write", outPath: "video-plan.json" });

  return { ok: true, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 } };
}
