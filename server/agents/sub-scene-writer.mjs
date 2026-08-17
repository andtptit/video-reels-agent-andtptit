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
import { writeFileSync, mkdirSync, existsSync, statSync, copyFileSync } from "fs";
import { join, resolve } from "path";
import { generateAndSaveImage } from "../providers/image/dashscope-image.mjs";
import * as pexels from "../providers/image/pexels.mjs";
import * as openverse from "../providers/image/openverse.mjs";
import { ensurePaperTextureCopied } from "../lib/paper-texture-cache.mjs";

// Stock-photo search providers for subStyles with `imageSource: "stock-photo"` — same
// lookup-map shape as generate-audio.mjs's TTS_PROVIDERS, so a 3rd provider slots in
// later without touching call sites.
const IMAGE_SEARCH_PROVIDERS = { pexels, openverse };
import { dimensionsForFormat } from "../lib/canvas.mjs";
import { lint } from "../tools/hyperframes-cli.mjs";
import { SUB_STYLES, DEFAULT_SUB_STYLE } from "../templates/sub-styles/index.mjs";
import { ensureFontCopied } from "../lib/fonts.mjs";
import { ensureGrainCopied } from "../lib/grain.mjs";
import { ensureKineticBgCopied } from "../lib/kinetic-bg.mjs";
import { findReusableImage, addToLibrary, copyFromLibrary, tryReserveReuseSlot, readUsedLibraryIds, recordUsedLibraryId } from "../lib/image-library.mjs";

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
  photoProvider = "pexels", // from video-plan.json's plan.photoProvider — which
  // IMAGE_SEARCH_PROVIDERS entry to use for subStyles with imageSource:"stock-photo"
  kenBurns = false, // from video-plan.json's plan.kenBurns — see templates/sub-styles/image-full-focus.mjs
  grain = false, // from video-plan.json's plan.grain — see templates/sub-styles/image-full-focus.mjs
  onEvent,
  signal,
}) {
  const style = SUB_STYLES[subStyle];
  if (!style) throw new Error(`Unknown sub style: "${subStyle}" (available: ${Object.keys(SUB_STYLES).join(", ")})`);
  const needsImage = style.needsImage !== false;
  // "investigation_board" acquires its image via Pexels search (scene.photo_keyword,
  // written by video-planner.mjs), not AI generation — a separate field from
  // `needsImage` so "does this style need an image" and "how does it get one" stay
  // independently answerable (see the style module's own doc comment).
  const usesStockPhoto = style.imageSource === "stock-photo";
  if (needsImage && !usesStockPhoto && !scene.image_prompt) {
    throw new Error(`Scene "${scene.sceneId}" thiếu image_prompt — style "${subStyle}" bắt buộc cần ảnh AI từ video-planner`);
  }
  if (needsImage && usesStockPhoto && !scene.photo_keyword) {
    throw new Error(`Scene "${scene.sceneId}" thiếu photo_keyword — style "${subStyle}" cần video-planner cung cấp từ khoá tìm ảnh Pexels`);
  }
  // A style may want a different AI-image aspect than the video's own canvas format
  // (e.g. a square 1:1 image inside a 9:16 video) — `format` below still drives the
  // COMPOSITION's width/height via dimensionsForFormat; `imageFormat` drives only
  // what's requested from the image provider/library, kept deliberately separate.
  const imageFormat = style.imageAspect || format;

  const n = sceneNumber(scene.sceneId);
  const padded = String(n).padStart(2, "0");
  const compositionId = `scene-${padded}`;
  const classPrefix = `s${n}`;
  const outPath = `compositions/scene_${padded}.html`;
  const { width, height } = dimensionsForFormat(format);

  const imagePath = `assets/images/scene_${padded}.png`;

  if (needsImage) {
    const imageAbsPath = join(projectDir, imagePath);
    mkdirSync(join(projectDir, "assets", "images"), { recursive: true });

    let imageResult;
    if (existsSync(imageAbsPath)) {
      // Already generated (or already reused/fetched) in a prior run — same
      // skip-if-exists convention generateAndSaveImage/searchAndSavePhoto themselves
      // use, checked here first so the branches below never even consider a scene
      // that's already settled.
      imageResult = { destPath: imageAbsPath, bytes: statSync(imageAbsPath).size, skipped: true };
    } else if (usesStockPhoto) {
      // No image-library reuse here — that mechanism is AI-generation-cost-driven
      // (see lib/image-library.mjs's own doc comment); stock search has no generation
      // cost to conserve, and the point of a fresh keyword search is finding a photo
      // that actually matches THIS scene's specific content, not reusing an old one.
      const provider = IMAGE_SEARCH_PROVIDERS[photoProvider];
      if (!provider) throw new Error(`Unknown photoProvider "${photoProvider}". Valid: ${Object.keys(IMAGE_SEARCH_PROVIDERS).join(", ")}`);
      const stockResult = await provider.searchAndSavePhoto({ query: scene.photo_keyword, format: imageFormat, destPath: imageAbsPath, signal });
      if (!stockResult.found) {
        throw new Error(
          `Không tìm thấy ảnh (${photoProvider}) phù hợp cho từ khoá "${scene.photo_keyword}" (scene "${scene.sceneId}") — thử đổi từ khoá, đổi nguồn ảnh, hoặc chạy lại bước video-plan.`
        );
      }
      imageResult = stockResult;
    } else if (imageLibrary?.enabled) {
      const usedIds = readUsedLibraryIds(projectDir);
      const match = findReusableImage({ profileSlug: imageLibrary.profileSlug, format: imageFormat, tags: scene.image_tags, excludeIds: usedIds });
      if (match && tryReserveReuseSlot(projectDir, imageLibrary.maxReuse)) {
        imageResult = copyFromLibrary(match, imageAbsPath);
        recordUsedLibraryId(projectDir, match.id);
      }
    }
    if (!imageResult) {
      imageResult = await generateAndSaveImage({
        prompt: scene.image_prompt,
        format: imageFormat,
        destPath: imageAbsPath,
        signal,
        ...(imageModel ? { model: imageModel } : {}),
      });
      // Only a genuinely FRESH generation (not skip-if-exists) is worth banking —
      // re-adding an already-reused or already-existing image would just bloat the
      // manifest with duplicates of images already in it.
      if (!imageResult.skipped && imageLibrary?.enabled) {
        const banked = addToLibrary({
          profileSlug: imageLibrary.profileSlug,
          format: imageFormat,
          tags: scene.image_tags,
          prompt: scene.image_prompt,
          srcImagePath: imageAbsPath,
        });
        // Found live (user report): scene_01 generates fresh + gets banked here,
        // then scene_03 of the SAME video (overlapping tags) immediately reused
        // scene_01's own image — 2 scenes in one video showing the identical
        // picture. Recording it as "used by this project" the moment it's banked
        // closes that window for every later scene in the same run.
        recordUsedLibraryId(projectDir, banked?.id);
      }
    }
    onEvent?.({
      type: imageResult.reusedFromLibrary ? "image-reused" : imageResult.skipped ? "image-skip" : "image",
      outPath: imagePath,
    });
  }

  // Some styles (e.g. image_blur_card) render the SAME image twice with different
  // CSS (blurred background + sharp card) — see that style module's own doc comment
  // for why two <img> tags pointing at one physical file (even with distinguishing
  // query strings) rendered unreliably in real HyperFrames renders. A genuinely
  // separate file on disk removes the ambiguity regardless of internal caching.
  let cardImagePath;
  if (needsImage && style.needsDuplicateImage) {
    cardImagePath = `assets/images/scene_${padded}_card.png`;
    const cardAbsPath = join(projectDir, cardImagePath);
    if (!existsSync(cardAbsPath)) copyFileSync(join(projectDir, imagePath), cardAbsPath);
  }

  const wordTimestamps = sceneTiming?._audio?.word_timestamps ?? [];
  const sceneDuration = sceneTiming?._audio?.scene_duration ?? scene.duration;

  // Copy the woff2 file(s) into this project's assets/fonts/ BEFORE writing the
  // composition — the composition's @font-face points at "../assets/fonts/..."
  // relative to compositions/, so the file must already exist there. Idempotent
  // (skips existing files), so calling this for every scene of the project is
  // cheap — same convention as generate-audio.mjs copying shared music/sfx once.
  ensureFontCopied(projectDir, fontFamily || DEFAULT_FONT);
  if (grain) ensureGrainCopied(projectDir);
  // kinetic_typography has no AI image but still needs a real <img> for the render
  // pipeline to correctly size/paint the composition (see its own doc comment) —
  // a static gradient PNG stands in for the missing AI background.
  const kineticBgPath = !needsImage ? ensureKineticBgCopied(projectDir, padded, n) : undefined;
  // "investigation_board" needs a shared aged-paper/map texture behind the photo —
  // fetched once workspace-wide, then copied into this project (see
  // lib/paper-texture-cache.mjs's own doc comment for why this is cached differently
  // from the per-scene photo above).
  const paperTexturePath = usesStockPhoto ? await ensurePaperTextureCopied(projectDir, n, { signal }) : undefined;
  if (usesStockPhoto && !paperTexturePath) {
    throw new Error(`Không tải được nền giấy/bản đồ (nguồn: ${photoProvider}) cho scene "${scene.sceneId}" — kiểm tra API key nếu dùng Pexels.`);
  }

  const html = style.render({
    compositionId,
    classPrefix,
    width,
    height,
    imagePath,
    ...(cardImagePath ? { cardImagePath } : {}),
    ...(kineticBgPath ? { bgImagePath: kineticBgPath } : {}),
    ...(paperTexturePath ? { paperTexturePath } : {}),
    wordTimestamps,
    sceneDuration,
    narration: sceneTiming?.narration ?? "",
    ...(fontFamily ? { fontFamily } : {}),
    kenBurns,
    grain,
    sceneIndex: n,
    ...(usesStockPhoto ? { labelText: scene.label_text, showEvidenceLink: Boolean(scene.show_evidence_link), callouts: scene.callouts } : {}),
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
