/**
 * Deterministic (no LLM) scene-composition writer for `template === "footage"` —
 * mirrors `sub-scene-writer.mjs`'s overall shape (resolve paths, produce the scene's
 * media, call a style's `render()`, lint-check, write the file) but swaps AI-image
 * generation for: pick random footage clips, cut/normalize/flip/speed each with
 * ffmpeg, concatenate into ONE final clip per scene.
 *
 * Deliberately produces exactly ONE `<video class="clip">` per scene composition (see
 * footage-style.mjs's own doc comment) rather than mounting N separate clip elements
 * on a HyperFrames timeline — a direct reaction to a real, still-not-fully-explained
 * intermittent render bug hit this same session with image-blur-card.mjs's 2-layer
 * `<img class="clip">` design. ffmpeg does the multi-clip assembly BEFORE HyperFrames
 * ever sees it, matching how MoneyPrinterTurbo's own `combine_videos()` works (ffmpeg
 * concat demuxer, not a multi-clip render timeline).
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { dimensionsForFormat } from "../lib/canvas.mjs";
import { lint } from "../tools/hyperframes-cli.mjs";
import { ensureFontCopied } from "../lib/fonts.mjs";
import { pickRandomClips, resolveLibraryDir, FOOTAGE_LIBRARY_DIR } from "../lib/footage-library.mjs";
import { cutClip, concatClips } from "../tools/ffmpeg-cli.mjs";
import * as footageStyle from "../templates/footage-style.mjs";

const DEFAULT_FONT = "Itim"; // must match templates/sub-styles/image-full-focus.mjs's own default

function sceneNumber(sceneId) {
  const digits = sceneId.match(/\d+/)?.[0] ?? "1";
  return parseInt(digits, 10);
}

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Splits `targetDuration` into `count` per-clip output durations, each clamped to
 * stay within [minSeconds, maxSeconds] while keeping the running total exactly on
 * target — every clip but the last is bounded so the REMAINING clips can still each
 * land in-range; the last clip absorbs whatever's left over.
 */
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

// Persists which source clip each footage GROUP (see build-footage-plan.mjs's
// `applyFootageGrouping`) picked, plus how far into it playback has progressed — so a
// follower scene generated in a later API call can find and continue the same clip the
// group's leader scene started. Scenes run sequentially within one project (Pipeline.jsx's
// "Chạy toàn bộ pipeline" awaits each scene in order), so no concurrent-write concern.
function readGroupState(footageDir) {
  const p = join(footageDir, "group-state.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function writeGroupState(footageDir, state) {
  writeFileSync(join(footageDir, "group-state.json"), JSON.stringify(state, null, 2));
}

/**
 * Cuts ONE scene's footage segment when it belongs to a multi-scene group. The
 * leader (first scene of the group) picks a fresh clip and records it in `groupState`;
 * every follower reuses that SAME source file — continuing forward through it for
 * video (so the group plays as one continuous shot across its scenes, not a jump back
 * to the start each time) or just redisplaying the same still for an image. Falls back
 * to picking its own clip if no leader entry exists yet (e.g. a scene re-generated out
 * of order) rather than crashing.
 */
async function writeGroupedFootage({
  projectDir,
  groupState,
  footageGroupId,
  isLeader,
  resolvedLibraryDir,
  destPath,
  sceneDuration,
  width,
  height,
  flipEnabled,
  zoomEnabled,
  zoomMin,
  zoomMax,
  colorGrade,
  speedEnabled,
  speedMin,
  speedMax,
  signal,
  onEvent,
}) {
  const key = String(footageGroupId);
  let entry = groupState[key];

  if (isLeader || !entry) {
    const [pick] = await pickRandomClips({ projectDir, count: 1, libraryDir: resolvedLibraryDir, includeImages: true });
    entry = {
      file: pick.file,
      kind: pick.kind,
      durationSec: pick.durationSec,
      cursorSec: 0,
      flip: flipEnabled && Math.random() < 0.5,
      zoomDirection: Math.random() < 0.5 ? "in" : "out",
    };
  }

  const isImage = entry.durationSec === null;
  const speedFactor = !isImage && speedEnabled ? randomInRange(speedMin, speedMax) : 1;
  const zoomFactor = zoomEnabled ? randomInRange(zoomMin, zoomMax) : 1;

  let startSec = 0;
  let rawCut = sceneDuration;
  if (!isImage) {
    const desiredRawCut = sceneDuration * speedFactor;
    rawCut = Math.min(desiredRawCut, entry.durationSec);
    startSec = entry.cursorSec;
    // Ran past the end of the source — wrap back to the start rather than erroring out
    // (a short library clip shared across a long group will otherwise run dry).
    if (startSec + rawCut > entry.durationSec) startSec = 0;
  }
  const effectiveSpeedFactor = isImage ? 1 : rawCut / sceneDuration;

  await cutClip({
    srcPath: join(resolvedLibraryDir, entry.file),
    destPath,
    startSec,
    outputDurationSec: sceneDuration,
    width,
    height,
    flip: entry.flip,
    zoomFactor,
    zoomDirection: entry.zoomDirection,
    colorGrade,
    speedFactor: effectiveSpeedFactor,
    signal,
  });

  onEvent?.({
    type: "footage-clip",
    sourceFile: entry.file,
    kind: entry.kind,
    startSec,
    outputDurationSec: sceneDuration,
    flip: entry.flip,
    speedFactor: effectiveSpeedFactor,
    zoomFactor,
    zoomDirection: zoomEnabled ? entry.zoomDirection : undefined,
    colorGrade: colorGrade !== "none" ? colorGrade : undefined,
    footageGroupId,
  });

  entry.cursorSec = isImage ? 0 : startSec + rawCut;
  groupState[key] = entry;
}

export async function runFootageWriter({
  projectDir,
  scene, // video-plan.json.scenes entry — { sceneId, duration }
  sceneTiming, // matching scenes-with-timing.json.scenes entry — narration + _audio.scene_duration
  format,
  footageConfig, // { minClipsPerScene, maxClipsPerScene, minClipSeconds, maxClipSeconds,
  // flipEnabled, speedEnabled, speedMin, speedMax, zoomEnabled, zoomMin, zoomMax,
  // colorGrade, captionPosition, fontFamily, libraryDir } — see build-footage-plan.mjs
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
    zoomEnabled = false,
    zoomMin = 1.05,
    zoomMax = 1.15,
    colorGrade = "none",
    captionPosition = "bottom",
    fontFamily,
    libraryDir,
  } = footageConfig ?? {};
  const resolvedLibraryDir = libraryDir ? resolveLibraryDir(libraryDir) : FOOTAGE_LIBRARY_DIR;

  const n = sceneNumber(scene.sceneId);
  const padded = String(n).padStart(2, "0");
  const compositionId = `scene-${padded}`;
  const classPrefix = `s${n}`;
  const outPath = `compositions/scene_${padded}.html`;
  const { width, height } = dimensionsForFormat(format);

  const sceneDuration = sceneTiming?._audio?.scene_duration ?? scene.duration;
  const footageDir = join(projectDir, "assets", "footage");
  mkdirSync(footageDir, { recursive: true });
  const finalVideoPath = `assets/footage/scene_${padded}.mp4`;
  const finalVideoAbsPath = join(projectDir, finalVideoPath);

  if (!existsSync(finalVideoAbsPath) && scene.footageGroupId != null) {
    // "2-3 scenes per photo/clip" mode (see build-footage-plan.mjs's applyFootageGrouping)
    // — a grouped scene always uses exactly ONE clip of its own duration (the "Số
    // clip/scene" min/max above is about splicing MULTIPLE clips together within a
    // single scene, a separate knob that would fight with sharing one clip ACROSS
    // scenes), so it bypasses the multi-clip-per-scene branch below entirely.
    const groupState = readGroupState(footageDir);
    await writeGroupedFootage({
      projectDir,
      groupState,
      footageGroupId: scene.footageGroupId,
      isLeader: !!scene.footageGroupLeader,
      resolvedLibraryDir,
      destPath: finalVideoAbsPath,
      sceneDuration,
      width,
      height,
      flipEnabled,
      zoomEnabled,
      zoomMin,
      zoomMax,
      colorGrade,
      speedEnabled,
      speedMin,
      speedMax,
      signal,
      onEvent,
    });
    writeGroupState(footageDir, groupState);
    onEvent?.({ type: "write", outPath: finalVideoPath });
  } else if (!existsSync(finalVideoAbsPath)) {
    const clipCount = Math.round(randomInRange(minClipsPerScene, maxClipsPerScene));
    const clipDurations = splitDuration(sceneDuration, clipCount, minClipSeconds, maxClipSeconds);
    // Found live (user report): with `includeImages` omitted (the original,
    // unchanged default), a folder containing only still images scanned as
    // completely empty ("Kho footage rỗng") even with 100+ files in it — this
    // template's own pool was always video-only by design (see this file's own doc
    // comment history), unlike the "Đọc Caption" tab (hook-scene-writer.mjs), which
    // already mixes images in. User wants the same mixing here — pass
    // includeImages: true and handle `pick.durationSec === null` (image) the same
    // way hook-scene-writer.mjs does below.
    const picks = await pickRandomClips({ projectDir, count: clipCount, libraryDir: resolvedLibraryDir, includeImages: true });

    const tempClipPaths = [];
    for (let i = 0; i < clipCount; i++) {
      const pick = picks[i % picks.length]; // guard: pool smaller than clipCount shouldn't happen given hundreds of files, but never crash on it
      const outputDurationSec = clipDurations[i];
      const flip = flipEnabled && Math.random() < 0.5;
      // A still image has no source timeline to seek into or speed up — durationSec
      // is null for image picks (see footage-library.mjs), so skip the raw-cut/
      // startSec math entirely rather than dividing by/comparing against null.
      const isImage = pick.durationSec === null;
      const speedFactor = !isImage && speedEnabled ? randomInRange(speedMin, speedMax) : 1;

      // Clamp the raw source cut to what the file actually has available — a source
      // shorter than `outputDurationSec * speedFactor` would otherwise make ffmpeg
      // fail outright; recompute the effective speed to match what's actually cut so
      // the output still lands on `outputDurationSec`.
      const desiredRawCut = outputDurationSec * speedFactor;
      const rawCut = isImage ? outputDurationSec : Math.min(desiredRawCut, pick.durationSec);
      const effectiveSpeedFactor = isImage ? 1 : rawCut / outputDurationSec;
      const startSec = isImage ? 0 : Math.max(0, Math.random() * (pick.durationSec - rawCut));
      // Random direction per clip (not just random magnitude) — applies to both
      // images and video, same as flip; see ffmpeg-cli.mjs's cutClip for how "in"
      // vs "out" gets baked into the crop ramp.
      const zoomFactor = zoomEnabled ? randomInRange(zoomMin, zoomMax) : 1;
      const zoomDirection = Math.random() < 0.5 ? "in" : "out";

      const destPath = clipCount === 1 ? finalVideoAbsPath : join(footageDir, `scene_${padded}_clip${i}.mp4`);
      await cutClip({
        srcPath: join(resolvedLibraryDir, pick.file),
        destPath,
        startSec,
        outputDurationSec,
        width,
        height,
        flip,
        zoomFactor,
        zoomDirection,
        colorGrade,
        speedFactor: effectiveSpeedFactor,
        signal,
      });
      onEvent?.({
        type: "footage-clip",
        sourceFile: pick.file,
        kind: pick.kind,
        startSec,
        outputDurationSec,
        flip,
        speedFactor: effectiveSpeedFactor,
        zoomFactor,
        zoomDirection: zoomEnabled ? zoomDirection : undefined,
        colorGrade: colorGrade !== "none" ? colorGrade : undefined,
      });
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

  const html = footageStyle.render({
    compositionId,
    classPrefix,
    width,
    height,
    videoPath: finalVideoPath,
    wordTimestamps: sceneTiming?._audio?.word_timestamps ?? [],
    sceneDuration,
    narration: sceneTiming?.narration ?? "",
    ...(fontFamily ? { fontFamily } : {}),
    captionPosition,
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
