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
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { probeDuration } from "../tools/ffmpeg-cli.mjs";

// Same pool root-composer.mjs's enforceSfxTags reads from — see that file's own doc
// comment on why this is a separate, code-only pool from the id-keyed assets/sfx/
// catalog "sub"/"motion" pick sfx_picks from.
const SFX_REACTION_DIR = resolve(import.meta.dirname, "..", "..", "assets", "sfx", "reactions");

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
export async function buildFootagePlan({ projectDir, format, footageConfig, onEvent }) {
  const scenesWithTiming = JSON.parse(readFileSync(join(projectDir, "scenes-with-timing.json"), "utf-8"));

  let scenes = applyFootageGrouping(
    scenesWithTiming.scenes.map((scene) => ({
      sceneId: scene.sceneId,
      duration: scene._audio?.scene_duration ?? scene.duration,
    })),
    footageConfig
  );
  scenes = await applySceneSfx(scenes, footageConfig);

  const plan = {
    template: "footage",
    format,
    total_duration: scenes.reduce((sum, s) => sum + (s.duration ?? 0) + (s.sfxDuration ?? 0), 0),
    scenes,
    footageConfig,
  };

  writeFileSync(join(projectDir, "video-plan.json"), JSON.stringify(plan, null, 2));
  onEvent?.({ type: "write", outPath: "video-plan.json" });

  return { ok: true, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 } };
}

// Groups consecutive scenes to share ONE footage pick instead of every scene picking
// its own — user request: switching image/video every single scene felt too choppy,
// wanted "2-3 scenes per photo/clip" instead. `scenesPerClipMin/Max` default to 1 (every
// scene picks its own footage — unchanged legacy behavior); grouping fields are only
// stamped onto scenes when the config actually asks for a group size above 1.
// footage-scene-writer.mjs reads `footageGroupId`/`footageGroupLeader` off each scene:
// the leader picks a clip and persists it (see its own group-state.json), followers
// reuse the same source file (continuing forward through it for video, so playback
// feels continuous rather than jumping) instead of picking a fresh one.
function applyFootageGrouping(scenes, footageConfig) {
  const min = Math.max(1, Math.round(Number(footageConfig?.scenesPerClipMin) || 1));
  const max = Math.max(min, Math.round(Number(footageConfig?.scenesPerClipMax) || min));
  if (max <= 1) return scenes;

  const result = [];
  let i = 0;
  let groupId = 0;
  while (i < scenes.length) {
    const groupSize = Math.min(scenes.length - i, min + Math.round(Math.random() * (max - min)));
    for (let j = 0; j < groupSize; j++) {
      result.push({ ...scenes[i + j], footageGroupId: groupId, footageGroupLeader: j === 0 });
    }
    i += groupSize;
    groupId++;
  }
  return result;
}

// Picks 1 reaction SFX per scene (random file from assets/sfx/reactions/, code-only —
// see root-composer.mjs's enforceSfxTags for why the LLM is never involved) and probes
// its REAL duration up front, at plan-build time — not lazily at root-composer time —
// so the pick is stable across root retries, and footage-scene-writer.mjs can extend
// its own footage cut to physically cover the SFX's tail (the clip keeps rolling
// under the sound instead of freezing/going blank once the scene's own captioned
// portion ends). User request: SFX must play in a dedicated slot AFTER the scene's
// voice finishes — never overlapping the last word — and the next scene must not
// start until the SFX itself finishes.
async function applySceneSfx(scenes, footageConfig) {
  if (!footageConfig?.sceneSfxEnabled) return scenes;
  let files;
  try {
    files = readdirSync(SFX_REACTION_DIR).filter((f) => f.endsWith(".mp3") && !f.startsWith("._"));
  } catch {
    files = [];
  }
  if (!files.length) return scenes;

  const result = [];
  for (const scene of scenes) {
    const file = files[Math.floor(Math.random() * files.length)];
    let duration;
    try {
      duration = await probeDuration(join(SFX_REACTION_DIR, file));
    } catch {
      result.push(scene); // unreadable file on disk — this scene just doesn't get an sfx
      continue;
    }
    result.push({ ...scene, sfxFile: file, sfxDuration: Math.round(duration * 1000) / 1000 });
  }
  return result;
}
