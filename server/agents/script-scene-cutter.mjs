/**
 * "Dán kịch bản có sẵn" — user pastes an already-written script (their own wording,
 * no AI rewriting allowed). Scene boundaries are 100% CODE-DECIDED — no LLM call at
 * all. Originally this asked a model to pick boundaries by meaning (with a blank line
 * as a strong hint); found live via real user testing that the model still
 * occasionally cut in the wrong place despite the hint — same "code writes
 * structural fields, never trust the LLM" lesson this codebase has hit repeatedly
 * elsewhere (root-composer.mjs's own doc comments). Since the user already knows
 * exactly where they want each scene to end (they wrote the script), there's nothing
 * left for a model to judge here — a line containing only "===" is now the sole,
 * unambiguous scene-cut marker, same role "---" already plays for splitting MULTIPLE
 * scripts pasted together (see Batch.jsx's parseScripts). A script with no "==="
 * marker at all falls back to the OLD blank-line-paragraph split, so a short script
 * the user didn't bother to mark up still comes out as more than one scene instead of
 * landing as a single giant one.
 *
 * `meaning`/`mood_hint` (used only by video-planner.mjs's LLM for template "sub"/
 * "motion", to help write visual_brief — template "footage" never reads them) no
 * longer come from an LLM either — left as sensible fixed defaults instead of
 * fabricating a fake "why this scene exists". video-planner still gets the real
 * narration text regardless, so this costs it nothing.
 *
 * master_content.md is built BY JOINING the final scene narrations (not the user's
 * raw pasted formatting) — same approach audio-import.mjs uses for the same
 * "narration must be a verbatim substring of master_content.md" invariant
 * (caption-chunks.mjs's alignment convention) to hold by construction.
 */
import { writeFileSync } from "fs";
import { join } from "path";

// Typical spoken Vietnamese narration pace for short-form video (matches edge-tts's
// own 1.1x-rate default elsewhere in this codebase) — estimated_duration is only
// ever a planning aid (real timing comes from the actual TTS call later, see
// scene-timing-assembler.mjs), so this doesn't need to be precise.
const WORDS_PER_SEC = 2.5;
const DEFAULT_MOOD_HINT = "cinematic";

const SCENE_MARKER_RE = /^={3,}\s*$/m;

function splitScenes(scriptText) {
  if (SCENE_MARKER_RE.test(scriptText)) {
    return scriptText
      .split(/^={3,}\s*$/m)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
  }
  // No explicit marker — fall back to the original blank-line-paragraph convention
  // (still 100% code, never was an LLM's decision on ITS OWN — the model only ever
  // got a hint about where these fell).
  return scriptText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * @param {object} params
 * @param {string} params.projectDir
 * @param {string} params.scriptText - the user's own, already-written script — never
 *   rewritten, only cut into scenes. Scenes separated by a line containing only
 *   "===" (falls back to blank-line paragraphs if no "===" is present at all).
 * @param {string} [params.platform] - "9:16" | "16:9", written into scenes.json
 * @param {(event: object) => void} [params.onEvent]
 * @returns {{ok: true, sceneCount: number, usage: object}}
 */
export async function runScriptSceneCutter({ projectDir, scriptText, platform = "9:16", onEvent = () => {} }) {
  const chunks = splitScenes(scriptText);
  if (!chunks.length) throw new Error("Kịch bản rỗng — không có nội dung nào để cắt cảnh.");

  const scenes = chunks.map((narration, i) => ({
    sceneId: `scene_${String(i + 1).padStart(2, "0")}`,
    narration,
    meaning: "",
    estimated_duration: Math.max(1, Math.round(narration.split(/\s+/).filter(Boolean).length / WORDS_PER_SEC)),
    mood_hint: DEFAULT_MOOD_HINT,
    is_hook: i === 0,
  }));

  const masterContent = scenes.map((s) => s.narration).join("\n\n");
  writeFileSync(join(projectDir, "master_content.md"), masterContent);

  const scenesJson = {
    master_content: "master_content.md",
    platform,
    total_estimated_duration: scenes.reduce((sum, s) => sum + s.estimated_duration, 0),
    scenes,
  };
  writeFileSync(join(projectDir, "scenes.json"), JSON.stringify(scenesJson, null, 2));
  onEvent({ type: "scene-cut-done", sceneCount: scenes.length });

  return { ok: true, sceneCount: scenes.length, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 } };
}
