/**
 * Deterministic (NO LLM call) counterpart to `agents/video-planner.mjs`, used when
 * `template === "footage"`. The whole point of this template is "don't care about
 * video content" — there's nothing for an LLM to write per scene (no visual_brief, no
 * image_prompt/image_tags), so unlike "motion"/"sub" this step is pure code: copy the
 * scene list straight from `scenes-with-timing.json` (already written by
 * generate-audio.mjs, template-agnostic) into `video-plan.json`, plus the
 * user-configured `footageConfig`. Cheaper and faster than the other two templates'
 * video-plan step — no DashScope call at all.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * @param {object} params
 * @param {string} params.projectDir
 * @param {string} params.format - "9:16" | "16:9"
 * @param {object} params.footageConfig - { minClipsPerScene, maxClipsPerScene,
 *   minClipSeconds, maxClipSeconds, flipEnabled, speedEnabled, speedMin, speedMax,
 *   zoomEnabled, zoomMin, zoomMax, fontFamily } — all CODE-owned, persisted as-is so
 *   every scene's generate call
 *   reads the same settings without the caller re-passing them (same reasoning as
 *   `video-planner.mjs`'s own persisted fields: fontFamily/kenBurns/grain for "sub").
 * @param {(event: object) => void} [params.onEvent]
 * @returns {{ok: true, usage: {promptTokens:0, completionTokens:0, totalTokens:0, apiCalls:0}}}
 */
export function buildFootagePlan({ projectDir, format, footageConfig, onEvent }) {
  const scenesWithTiming = JSON.parse(readFileSync(join(projectDir, "scenes-with-timing.json"), "utf-8"));

  const scenes = scenesWithTiming.scenes.map((scene) => ({
    sceneId: scene.sceneId,
    duration: scene._audio?.scene_duration ?? scene.duration,
  }));

  const plan = {
    template: "footage",
    format,
    total_duration: scenes.reduce((sum, s) => sum + (s.duration ?? 0), 0),
    scenes,
    footageConfig,
  };

  writeFileSync(join(projectDir, "video-plan.json"), JSON.stringify(plan, null, 2));
  onEvent?.({ type: "write", outPath: "video-plan.json" });

  return { ok: true, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 } };
}
