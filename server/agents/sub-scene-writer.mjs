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
import { writeFileSync, mkdirSync, existsSync, statSync } from "fs";
import { join, resolve } from "path";
import { generateAndSaveImage } from "../providers/image/dashscope-image.mjs";
import { dimensionsForFormat } from "../lib/canvas.mjs";
import { lint } from "../tools/hyperframes-cli.mjs";
import { SUB_STYLES, DEFAULT_SUB_STYLE } from "../templates/sub-styles/index.mjs";
import { ensureFontCopied } from "../lib/fonts.mjs";
import { ensureGrainCopied } from "../lib/grain.mjs";
import { findReusableImage, addToLibrary, copyFromLibrary, tryReserveReuseSlot } from "../lib/image-library.mjs";

const DEFAULT_FONT = "Itim"; // must match templates/sub-styles/image-full-focus.mjs's own default

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
  fontFamily, // Google Fonts family, must support Vietnamese — see the style
  // module's own default/allowlist (e.g. templates/sub-styles/image-full-focus.mjs)
  imageModel, // DashScope image model id — undefined lets generateAndSaveImage fall
  // back to its own env-configured default (DASHSCOPE_MODEL_IMAGE / "wan2.6-image")
  imageLibrary, // { enabled, maxReuse, profileSlug } from video-plan.json — see
  // lib/image-library.mjs. undefined/enabled:false skips reuse entirely.
  kenBurns = false, // from video-plan.json's plan.kenBurns — see templates/sub-styles/image-full-focus.mjs
  grain = false, // from video-plan.json's plan.grain — see templates/sub-styles/image-full-focus.mjs
  onEvent,
  signal,
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
  const imageAbsPath = join(projectDir, imagePath);
  mkdirSync(join(projectDir, "assets", "images"), { recursive: true });

  let imageResult;
  if (existsSync(imageAbsPath)) {
    // Already generated (or already reused) in a prior run — same skip-if-exists
    // convention generateAndSaveImage itself uses, checked here first so the
    // library-reuse path below never even considers a scene that's already settled.
    imageResult = { destPath: imageAbsPath, bytes: statSync(imageAbsPath).size, skipped: true };
  } else if (imageLibrary?.enabled) {
    const match = findReusableImage({ profileSlug: imageLibrary.profileSlug, format, tags: scene.image_tags });
    if (match && tryReserveReuseSlot(projectDir, imageLibrary.maxReuse)) {
      imageResult = copyFromLibrary(match, imageAbsPath);
    }
  }
  if (!imageResult) {
    imageResult = await generateAndSaveImage({
      prompt: scene.image_prompt,
      format,
      destPath: imageAbsPath,
      signal,
      ...(imageModel ? { model: imageModel } : {}),
    });
    // Only a genuinely FRESH generation (not skip-if-exists) is worth banking —
    // re-adding an already-reused or already-existing image would just bloat the
    // manifest with duplicates of images already in it.
    if (!imageResult.skipped && imageLibrary?.enabled) {
      addToLibrary({
        profileSlug: imageLibrary.profileSlug,
        format,
        tags: scene.image_tags,
        prompt: scene.image_prompt,
        srcImagePath: imageAbsPath,
      });
    }
  }
  onEvent?.({
    type: imageResult.reusedFromLibrary ? "image-reused" : imageResult.skipped ? "image-skip" : "image",
    outPath: imagePath,
  });

  const wordTimestamps = sceneTiming?._audio?.word_timestamps ?? [];
  const sceneDuration = sceneTiming?._audio?.scene_duration ?? scene.duration;

  // Copy the woff2 file(s) into this project's assets/fonts/ BEFORE writing the
  // composition — the composition's @font-face points at "../assets/fonts/..."
  // relative to compositions/, so the file must already exist there. Idempotent
  // (skips existing files), so calling this for every scene of the project is
  // cheap — same convention as generate-audio.mjs copying shared music/sfx once.
  ensureFontCopied(projectDir, fontFamily || DEFAULT_FONT);
  if (grain) ensureGrainCopied(projectDir);

  const html = style.render({
    compositionId,
    classPrefix,
    width,
    height,
    imagePath,
    wordTimestamps,
    sceneDuration,
    narration: sceneTiming?.narration ?? "",
    ...(fontFamily ? { fontFamily } : {}),
    kenBurns,
    grain,
  });

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
  // Only treat severity:"error" as a real failure — confirmed live this was a real
  // bug: a scene with zero errors but one "timeline_track_too_dense" WARNING (just
  // advisory — "consider splitting into smaller files", never a render blocker) was
  // being reported as failed. That warning is also now the expected, common case for
  // this template specifically, since caption chunking (see caption-chunks.mjs)
  // deliberately puts several `class="clip"` chunk divs on one track — treating any
  // finding at all as fatal would fail most "sub" scenes going forward.
  const ownErrors = ownFindings.filter((f) => f.severity === "error");
  const ownWarnings = ownFindings.filter((f) => f.severity !== "error");
  if (ownWarnings.length) onEvent?.({ type: "static-check", outPath, staticWarnings: ownWarnings });
  if (ownErrors.length) {
    return { ok: false, outPath, error: `Lint lỗi trên ${outPath}`, findings: ownErrors, usage: null };
  }

  return { ok: true, outPath, staticWarnings: ownWarnings, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 } };
}
