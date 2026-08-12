/**
 * Deterministic (no LLM) scene-composition writer for template "hook" — the same
 * "pick random clips, cut/normalize/flip/speed with ffmpeg, concatenate into ONE
 * final clip" mechanism as agents/footage-scene-writer.mjs, imported at the low
 * level (pickRandomClips/cutClip/concatClips) rather than reusing that module's own
 * top-level function — this format always has exactly ONE "scene" (the whole video,
 * no narration to cut by, see plan.md), so footage-scene-writer.mjs's per-scene loop
 * over `scenesTiming`/`_audio`/karaoke wiring doesn't apply here at all.
 */
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { dimensionsForFormat } from "../lib/canvas.mjs";
import { lint } from "../tools/hyperframes-cli.mjs";
import { ensureFontCopied } from "../lib/fonts.mjs";
import { pickRandomClips, resolveLibraryDir, FOOTAGE_LIBRARY_DIR } from "../lib/footage-library.mjs";
import { cutClip, concatClips } from "../tools/ffmpeg-cli.mjs";
import * as hookStyle from "../templates/hook-style.mjs";

const DEFAULT_FONT = "Itim";

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

/** Same split-into-per-clip-durations helper as footage-scene-writer.mjs's own —
 *  duplicated rather than imported since that module isn't exported for reuse
 *  (plan.md's decision: keep this pipeline fully decoupled from the "footage"
 *  template's own agent, only share the low-level ffmpeg/library primitives). */
function splitDuration(targetDuration, count, minSeconds, maxSeconds) {
  const durations = [];
  let remaining = targetDuration;
  for (let i = 0; i < count - 1; i++) {
    const clipsLeftAfterThis = count - 1 - i;
    const lower = Math.max(minSeconds, remaining - clipsLeftAfterThis * maxSeconds);
    const upper = Math.min(maxSeconds, remaining - clipsLeftAfterThis * minSeconds);
    const d = upper > lower ? randomInRange(lower, upper) : Math.max(0.5, lower);
    durations.push(d);
    remaining -= d;
  }
  durations.push(Math.max(0.5, remaining));
  return durations;
}

/**
 * @param {object} params
 * @param {string} params.projectDir
 * @param {string} params.format - "9:16" | "16:9"
 * @param {number} params.videoDurationSec
 * @param {object} params.hookContent - { hook, highlightWord, count, topic }
 * @param {string} params.ctaText
 * @param {string} params.highlightColor
 * @param {number} [params.blurPercent] - 0-100, forwarded to hook-style.mjs's px formula
 * @param {string} [params.footageFolder] - absolute path override; falsy = shared
 *   FOOTAGE_LIBRARY_DIR (same default `pickRandomClips` itself already has)
 * @param {object} params.footageConfig - same shape as "footage" template's own
 * @param {(event: object) => void} [params.onEvent]
 * @param {AbortSignal} [params.signal]
 */
export async function runHookSceneWriter({
  projectDir,
  format,
  videoDurationSec,
  hookContent,
  ctaText,
  highlightColor,
  blurPercent,
  footageFolder,
  footageConfig,
  onEvent,
  signal,
}) {
  const {
    minClipsPerScene = 1,
    maxClipsPerScene = 3,
    minClipSeconds = 3,
    maxClipSeconds = 6,
    flipEnabled = false,
    speedEnabled = false,
    speedMin = 1.0,
    speedMax = 1.3,
    fontFamily,
  } = footageConfig ?? {};

  const compositionId = "scene-01";
  const classPrefix = "s1";
  const outPath = "compositions/scene_01.html";
  const { width, height } = dimensionsForFormat(format);

  // Found live (user report): building `srcPath` below with a raw, un-resolved
  // `footageFolder` (relative paths resolve against THIS PROCESS's cwd, server/, not
  // the workspace root) made ffmpeg fail with "No such file or directory" even though
  // pickRandomClips/scanFootageLibrary (footage-library.mjs) already resolve the same
  // input correctly internally — that fix never propagated out to this separate local
  // copy of the path used for the actual cutClip() call. Resolve once, here, so both
  // uses (passed into pickRandomClips below AND joined into srcPath) agree.
  const libraryDir = resolveLibraryDir(footageFolder || FOOTAGE_LIBRARY_DIR);
  const footageDir = join(projectDir, "assets", "footage");
  mkdirSync(footageDir, { recursive: true });
  const finalVideoPath = "assets/footage/scene_01.mp4";
  const finalVideoAbsPath = join(projectDir, finalVideoPath);

  if (!existsSync(finalVideoAbsPath)) {
    const clipCount = Math.round(randomInRange(minClipsPerScene, maxClipsPerScene));
    const clipDurations = splitDuration(videoDurationSec, clipCount, minClipSeconds, maxClipSeconds);
    // includeImages: true — this tab's whole point (unlike template "footage") is
    // that the background pool can mix stills in with video clips, see
    // lib/footage-library.mjs's own doc comment.
    const picks = await pickRandomClips({ projectDir, count: clipCount, libraryDir, includeImages: true });

    const tempClipPaths = [];
    for (let i = 0; i < clipCount; i++) {
      const pick = picks[i % picks.length];
      const outputDurationSec = clipDurations[i];
      const flip = flipEnabled && Math.random() < 0.5;
      // A still image has no source timeline to seek into or speed up — durationSec
      // is null for image picks (see footage-library.mjs), so skip the raw-cut/
      // startSec math entirely rather than dividing by/comparing against null.
      const isImage = pick.durationSec === null;
      const speedFactor = !isImage && speedEnabled ? randomInRange(speedMin, speedMax) : 1;
      const desiredRawCut = outputDurationSec * speedFactor;
      const rawCut = isImage ? outputDurationSec : Math.min(desiredRawCut, pick.durationSec);
      const effectiveSpeedFactor = isImage ? 1 : rawCut / outputDurationSec;
      const startSec = isImage ? 0 : Math.max(0, Math.random() * (pick.durationSec - rawCut));

      const destPath = clipCount === 1 ? finalVideoAbsPath : join(footageDir, `scene_01_clip${i}.mp4`);
      await cutClip({
        srcPath: join(libraryDir, pick.file),
        destPath,
        startSec,
        outputDurationSec,
        width,
        height,
        flip,
        speedFactor: effectiveSpeedFactor,
        signal,
      });
      onEvent?.({ type: "footage-clip", sourceFile: pick.file, kind: pick.kind, startSec, outputDurationSec, flip, speedFactor: effectiveSpeedFactor });
      if (clipCount > 1) tempClipPaths.push(destPath);
    }

    if (clipCount > 1) {
      await concatClips({ clipPaths: tempClipPaths, destPath: finalVideoAbsPath, signal });
    }
    onEvent?.({ type: "write", outPath: finalVideoPath });
  } else {
    onEvent?.({ type: "footage-skip", outPath: finalVideoPath });
  }

  ensureFontCopied(projectDir, fontFamily || DEFAULT_FONT);

  const html = hookStyle.render({
    compositionId,
    classPrefix,
    width,
    height,
    videoPath: finalVideoPath,
    sceneDuration: videoDurationSec,
    hook: hookContent?.hook,
    highlightWord: hookContent?.highlightWord,
    count: hookContent?.count,
    topic: hookContent?.topic,
    ctaText,
    highlightColor,
    blurPercent,
    ...(fontFamily ? { fontFamily } : {}),
  });

  mkdirSync(join(projectDir, "compositions"), { recursive: true });
  writeFileSync(join(projectDir, outPath), html, "utf-8");
  onEvent?.({ type: "write", outPath });

  const lintResult = await lint(projectDir);
  const outFileAbs = resolve(projectDir, outPath);
  const ownFindings = (lintResult.findings ?? []).filter((f) => f.file && resolve(f.file) === outFileAbs);
  const ownErrors = ownFindings.filter((f) => f.severity === "error");
  const ownWarnings = ownFindings.filter((f) => f.severity !== "error");
  if (ownWarnings.length) onEvent?.({ type: "static-check", outPath, staticWarnings: ownWarnings });
  if (ownErrors.length) {
    return { ok: false, outPath, error: `Lint lỗi trên ${outPath}`, findings: ownErrors, usage: null };
  }

  return { ok: true, outPath, staticWarnings: ownWarnings, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 } };
}
