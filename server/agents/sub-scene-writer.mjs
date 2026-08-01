/**
 * Deterministic counterpart to scene-writer.mjs, used when video-plan.json's
 * `template === "sub"`. Unlike scene-writer (an LLM agent that writes creative
 * card/animation layouts), this path never calls DashScope for the composition
 * HTML — the karaoke-subtitle layout is fully computable from data already on disk
 * (the AI image prompt from video-planner, the word-level timestamps from
 * generate-audio.mjs), so there's nothing for a model to get wrong. Only DashScope
 * call here is the image generation itself (same wan2.6-image provider scene-writer
 * uses for its own ai-image style).
 */
import { writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { generateAndSaveImage } from "../providers/image/dashscope-image.mjs";
import { dimensionsForFormat } from "../lib/canvas.mjs";
import { lint } from "../tools/hyperframes-cli.mjs";
import { SUB_STYLES, DEFAULT_SUB_STYLE } from "../templates/sub-styles/index.mjs";

function sceneNumber(sceneId) {
  const digits = sceneId.match(/\d+/)?.[0] ?? "1";
  return parseInt(digits, 10);
}

export async function runSubSceneWriter({
  projectDir,
  scene, // video-plan.json.scenes entry — needs `image_prompt` (video-planner writes
  // this whenever template === "sub" forces visualStyle="ai-image" — see routes.mjs)
  sceneTiming, // matching scenes-with-timing.json.scenes entry — carries `narration`
  // and `_audio.word_timestamps` / `_audio.scene_duration`, neither of which lives in
  // video-plan.json (checked live: video-planner's schema has no `_audio` field)
  format,
  subStyle = DEFAULT_SUB_STYLE,
  onEvent,
}) {
  const style = SUB_STYLES[subStyle];
  if (!style) throw new Error(`Unknown sub style: "${subStyle}" (available: ${Object.keys(SUB_STYLES).join(", ")})`);
  if (!scene.image_prompt) {
    throw new Error(`Scene "${scene.sceneId}" thiếu image_prompt — style "sub" bắt buộc cần ảnh AI từ video-planner`);
  }

  const n = sceneNumber(scene.sceneId);
  const padded = String(n).padStart(2, "0");
  const compositionId = `scene-${padded}`;
  const classPrefix = `s${n}`;
  const outPath = `compositions/scene_${padded}.html`;
  const { width, height } = dimensionsForFormat(format);

  const imagePath = `assets/images/scene_${padded}.png`;
  mkdirSync(join(projectDir, "assets", "images"), { recursive: true });
  await generateAndSaveImage({ prompt: scene.image_prompt, format, destPath: join(projectDir, imagePath) });
  onEvent?.({ type: "image", outPath: imagePath });

  const wordTimestamps = sceneTiming?._audio?.word_timestamps ?? [];
  const sceneDuration = sceneTiming?._audio?.scene_duration ?? scene.duration;

  const html = style.render({ compositionId, classPrefix, width, height, imagePath, wordTimestamps, sceneDuration });

  mkdirSync(join(projectDir, "compositions"), { recursive: true });
  writeFileSync(join(projectDir, outPath), html, "utf-8");
  onEvent?.({ type: "write", outPath });

  const lintResult = await lint(projectDir);
  // hyperframes reports `finding.file` as an absolute path (confirmed live via
  // --verbose) — compare resolved paths, not string suffix-matching, so this can't
  // be fooled by e.g. "scene_1.html" vs "scene_01.html" both ending similarly. Own
  // findings only — a project mid-pipeline commonly has pre-existing findings from
  // other not-yet-written scenes (same reasoning as scene-writer.mjs's baseline
  // diff), so filter to this file specifically rather than requiring the whole
  // project clean.
  const outFileAbs = resolve(projectDir, outPath);
  const ownFindings = (lintResult.findings ?? []).filter((f) => f.file && resolve(f.file) === outFileAbs);
  if (ownFindings.length) {
    return { ok: false, outPath, error: `Lint lỗi trên ${outPath}`, findings: ownFindings, usage: null };
  }

  return { ok: true, outPath, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 } };
}
