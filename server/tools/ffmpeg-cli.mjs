/**
 * Thin wrapper around the `ffmpeg`/`ffprobe` binaries (already a hard dependency of
 * this workspace — hyperframes itself requires ffmpeg for local rendering, see
 * CLAUDE.md's troubleshooting notes) for the "footage" template's clip cutting.
 *
 * No Node ffmpeg wrapper library is used — `server/package.json` has none, and the
 * existing convention for shelling out to an external CLI in this codebase
 * (`hyperframes-cli.mjs`'s `render()`) is a raw `execFile` + `signal`/`CancelledError`
 * wiring, mirrored here exactly rather than introducing a new dependency.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join, extname } from "path";
import { tmpdir } from "os";
import { CancelledError } from "../jobs/cancel-registry.mjs";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 15_000;
const CUT_TIMEOUT_MS = 60_000;
const CONCAT_TIMEOUT_MS = 30_000;

// Duplicated from footage-library.mjs's own set rather than imported — that module
// already imports probeDuration FROM this file, so importing back would be a
// circular dependency for the sake of one small constant.
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

// "Color grade" presets for the "footage" template — found live (user request): a
// moody/dark grade matches the "nghiêm túc, kỷ luật" (serious, disciplined) vibe of
// motivation/gym-style profiles far better than the raw source color. `eq` handles
// brightness/contrast/saturation; `colorbalance` pushes shadows/midtones toward
// cool blue for the "dramatic" preset (a plain brightness drop alone just looks
// underexposed, not intentional) — subtle enough not to need per-clip tuning.
const COLOR_GRADES = {
  none: null,
  dark: "eq=brightness=-0.05:contrast=1.1:saturation=0.9",
  "dark-dramatic": "eq=brightness=-0.1:contrast=1.25:saturation=0.75,colorbalance=rs=-0.05:gs=-0.02:bs=0.08:rm=-0.03:gm=-0.01:bm=0.05",
};

// Output frame rate — both the encoder (`-r`) and the zoom filter's own frame-count
// math below are pinned to this same value so `n` (the crop filter's per-frame
// counter) reliably corresponds to `elapsedSeconds * OUTPUT_FPS`, regardless of the
// source's own native frame rate.
const OUTPUT_FPS = 30;

/**
 * Builds a "digital zoom" filter that ramps linearly over `durationSec`, driven by
 * `n` (frame index — always 0-based per filter invocation, unlike `t` which can
 * start at a non-zero offset after input-side `-ss` seeking) rather than zoompan's
 * own frame-count/hold semantics, which behave differently for a looped still image
 * vs. a real video source and are a frequent source of silent off-by-one/no-op bugs.
 *
 * Grows/shrinks the frame via `scale` (continuously, `eval=frame`) to a size that
 * changes every frame, THEN crops a FIXED window (constant `${width}x${height}`,
 * no time-varying expression) out of the center. Found live this is meaningfully
 * SMOOTHER than the more obvious "shrink a crop window, then scale it back up"
 * approach: `crop`'s own w/h expressions (verified via consecutive-frame PSNR —
 * alternating ~28dB/~89dB pairs, i.e. some frames visually frozen then a visible
 * jump) update in coarse, unevenly-spaced steps for small per-frame deltas, while
 * `scale` has an explicit `eval=frame` option (crop has none) and produces
 * consistent ~30-34dB pairs — no frozen frames — for the same zoom range. Moving
 * the only per-frame arithmetic onto `scale` and leaving `crop`'s own w/h as plain
 * constants (only its default centered x/y adapts, driven by scale's already-smooth
 * output size) sidesteps whatever coarser rounding `crop` applies to expression-
 * evaluated dimensions.
 *
 * "in" grows 1.0 → zoomFactor (image/footage appears to move closer); "out" starts
 * at zoomFactor and shrinks back to 1.0 (pulls back). Both directions produce the
 * SAME scale/crop shape, just opposite progressions of the same expression.
 *
 * @param {number} width - target canvas width (post scale/crop normalization)
 * @param {number} height - target canvas height
 * @param {number} durationSec - how long the ramp should take to complete — MUST be
 *   the duration of the clip AT THE POINT this filter sits in the chain (i.e. the
 *   raw pre-speed-change duration if placed before `setpts`, not the final sped-up
 *   output duration — see cutClip's own call site for why)
 * @param {number} zoomFactor - e.g. 1.15 = 15% max zoom
 * @param {"in"|"out"} direction
 * @returns {string} filter chain segment (no leading/trailing comma)
 */
// Confirmed live: if the crop area evaluates to EXACTLY the input's own
// width/height on frame 0 (i.e. zoom starts at a literal no-op crop), this ffmpeg
// build's crop filter silently stops re-evaluating w/h/x/y for every subsequent
// frame — the whole clip renders as if zoom were never applied, no error anywhere
// (a "zoom in" clip, which starts at zoom=1.0 exactly, hit this; "zoom out",
// which never touches exactly 1.0 until its very last frame, didn't). Keeping the
// least-zoomed end of the ramp at 1+ZOOM_EPSILON instead of a literal 1.0 avoids
// the no-op crop entirely — imperceptible on screen, but keeps the filter's
// per-frame re-evaluation alive for the whole clip. Still applies with the scale-
// based approach below (scale itself has the same identity-value risk).
const ZOOM_EPSILON = 0.02;

function buildZoomFilter(width, height, durationSec, zoomFactor, direction) {
  const totalFrames = Math.max(1, Math.round(durationSec * OUTPUT_FPS));
  const minZoom = 1 + ZOOM_EPSILON;
  // `\,` escapes the comma inside min(...) so ffmpeg's filtergraph parser doesn't
  // mistake it for a new filter separator (it operates on the whole -vf string,
  // not aware of parens/quotes inside a single filter's option value).
  const progress = `min(n/${totalFrames}\\,1)`;
  const zoomExpr =
    direction === "out"
      ? `(${zoomFactor}-(${zoomFactor}-${minZoom})*${progress})`
      : `(${minZoom}+(${zoomFactor}-${minZoom})*${progress})`;
  const scaledW = `'${width}*${zoomExpr}'`;
  const scaledH = `'${height}*${zoomExpr}'`;
  // `flags=lanczos` — found live (user report): ffmpeg's default scaler is
  // bilinear, which looks visibly soft/blurry on a CONTINUOUS per-frame upscale
  // (zooming in from 1.0x every frame is, in effect, a mild upscale every frame).
  // Lanczos is sharper for exactly this case; the extra compute cost is negligible
  // for a single 3-8s clip.
  return `scale=w=${scaledW}:h=${scaledH}:eval=frame:flags=lanczos,crop=w=${width}:h=${height}`;
}

function throwIfCancelled(err, signal) {
  if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
  throw err;
}

/** @returns {Promise<number>} source file duration in seconds */
export async function probeDuration(filePath, { signal } = {}) {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
      { timeout: PROBE_TIMEOUT_MS, signal }
    );
    const seconds = parseFloat(stdout.trim());
    if (!Number.isFinite(seconds)) throw new Error(`ffprobe trả về duration không hợp lệ: "${stdout.trim()}"`);
    return seconds;
  } catch (err) {
    throwIfCancelled(err, signal);
  }
}

/**
 * Cuts a random segment out of a source video, normalizing it to the target canvas
 * size (scale-to-cover + center crop, matching CSS `object-fit:cover` so every clip
 * — regardless of source resolution/aspect — comes out identical dimensions, which
 * `concatClips` below relies on for a clean `-c copy` concat) with optional flip/speed.
 *
 * If `srcPath` is a still image (the "Đọc Caption" tab's footage pool can mix images
 * in, see lib/footage-library.mjs's `includeImages`), takes a completely different
 * ffmpeg path: `-loop 1` turns the image into an "infinite" input, so `-t` placed
 * AFTER `-i` correctly caps just the OUTPUT to `outputDurationSec` — the opposite
 * placement rule from the video path below, but not a re-run of that bug: this only
 * matters when a REAL input duration + speed filter are both in play, neither of
 * which applies to a looped still. `startSec`/`speedFactor` are meaningless for a
 * static image and silently ignored.
 *
 * @param {object} params
 * @param {string} params.srcPath
 * @param {string} params.destPath
 * @param {number} params.startSec - offset into the SOURCE file to start cutting
 *   (video only — ignored for images)
 * @param {number} params.outputDurationSec - desired duration of the OUTPUT clip
 * @param {number} params.width
 * @param {number} params.height
 * @param {boolean} [params.flip]
 * @param {number} [params.speedFactor] - e.g. 1.3 = 30% faster; omit/1 for no change
 *   (video only — ignored for images). The RAW source cut is
 *   `outputDurationSec * speedFactor` seconds (caller must ensure the source has that
 *   much material available from `startSec`), sped up via `setpts` to land back on
 *   exactly `outputDurationSec`.
 * @param {number} [params.zoomFactor] - e.g. 1.15 = max 15% zoom; omit/1 for no zoom.
 *   Applies to BOTH images and video.
 * @param {"in"|"out"} [params.zoomDirection] - "in" grows across the clip, "out"
 *   starts zoomed and shrinks back. Ignored if zoomFactor is omitted/1.
 * @param {"none"|"dark"|"dark-dramatic"} [params.colorGrade] - see COLOR_GRADES
 *   above. Applies to BOTH images and video, AFTER zoom/flip (order doesn't matter
 *   for a global color filter, but keeping it last avoids re-deriving zoom's
 *   already-correct crop window against a color-shifted frame).
 * @param {AbortSignal} [params.signal]
 */
export async function cutClip({
  srcPath,
  destPath,
  startSec,
  outputDurationSec,
  width,
  height,
  flip = false,
  speedFactor = 1,
  zoomFactor = 1,
  zoomDirection = "in",
  colorGrade = "none",
  signal,
}) {
  // `fps=OUTPUT_FPS` up front makes the zoom filter's own frame-count math (`n`
  // inside buildZoomFilter) exact regardless of the source's native frame rate —
  // without it, a still image's default demux rate (or a video shot at 24/60fps)
  // would desync the zoom ramp from real elapsed time. The later `-r` output flag
  // becomes a no-op confirmation at that point, not load-bearing on its own anymore.
  // `flags=lanczos` here too — same softness issue as buildZoomFilter's own scale,
  // just for the base normalize-to-canvas-size step every clip goes through
  // (source resolution rarely matches the target exactly, so this scale is doing
  // real up/down-sampling work, not a no-op).
  const filters = [`fps=${OUTPUT_FPS}`, `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${width}:${height}`];

  if (IMAGE_EXTENSIONS.has(extname(srcPath).toLowerCase())) {
    if (zoomFactor > 1) filters.push(buildZoomFilter(width, height, outputDurationSec, zoomFactor, zoomDirection));
    if (flip) filters.push("hflip");
    if (COLOR_GRADES[colorGrade]) filters.push(COLOR_GRADES[colorGrade]);
    try {
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-loop", "1",
          "-i", srcPath,
          "-t", String(outputDurationSec),
          "-vf", filters.join(","),
          "-an",
          "-r", String(OUTPUT_FPS),
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-pix_fmt", "yuv420p",
          destPath,
        ],
        { timeout: CUT_TIMEOUT_MS, signal, maxBuffer: 1024 * 1024 * 10 }
      );
    } catch (err) {
      throwIfCancelled(err, signal);
    }
    return;
  }

  const rawCutDurationSec = outputDurationSec * speedFactor;
  // Zoom BEFORE setpts, sized to rawCutDurationSec (not outputDurationSec) — setpts
  // only relabels PTS timestamps, it doesn't drop/duplicate frames, so the frame
  // COUNT flowing through the zoom filter (and therefore its `n`-based progress) is
  // still based on the RAW pre-speed-change duration regardless of chain position.
  // Sizing the ramp to that same raw duration makes the zoom complete exactly when
  // the (now sped-up) clip reaches its final outputDurationSec, instead of
  // finishing early/late and holding at the extreme for the remainder.
  if (zoomFactor > 1) filters.push(buildZoomFilter(width, height, rawCutDurationSec, zoomFactor, zoomDirection));
  if (flip) filters.push("hflip");
  if (COLOR_GRADES[colorGrade]) filters.push(COLOR_GRADES[colorGrade]);
  if (speedFactor !== 1) filters.push(`setpts=${(1 / speedFactor).toFixed(6)}*PTS`);

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        // `-ss`/`-t` MUST come BEFORE `-i` to be input-side options (trims the SOURCE
        // to the raw cut window before any filter runs) — found live: placing them
        // after `-i` makes ffmpeg treat `-t` as an OUTPUT duration cap instead, which
        // silently defeats `setpts` speed changes (the output gets capped at the RAW
        // cut length instead of the shorter sped-up length — confirmed by probing a
        // "speedFactor:1.5, outputDurationSec:3" cut and getting a 4.5s file back,
        // the raw pre-speed duration, not 3s).
        "-ss", String(startSec),
        "-t", String(rawCutDurationSec),
        "-i", srcPath,
        "-vf", filters.join(","),
        "-an", // no audio — sub karaoke doesn't need the footage's own sound, and no
        // <audio> companion element is written for this style (see footage-style.mjs)
        "-r", String(OUTPUT_FPS),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        destPath,
      ],
      { timeout: CUT_TIMEOUT_MS, signal, maxBuffer: 1024 * 1024 * 10 }
    );
  } catch (err) {
    throwIfCancelled(err, signal);
  }
}

/**
 * Cuts a segment out of a real audio file (the "tạo từ audio có sẵn" flow's per-scene
 * split — see audio-import.mjs) — `cutClip` above is video-only (`-an`, scale/crop,
 * `libx264`), not reusable here. Re-encodes via `libmp3lame` rather than `-c copy`:
 * stream-copy can only cut on codec frame boundaries, not precise enough to land on
 * the exact word-boundary timestamp the scene-cutter agent chose — captions are keyed
 * to those same timestamps, so drift here would misalign them.
 * @param {object} params
 * @param {string} params.srcPath
 * @param {string} params.destPath
 * @param {number} params.startSec
 * @param {number} params.endSec
 * @param {AbortSignal} [params.signal]
 */
export async function cutAudioClip({ srcPath, destPath, startSec, endSec, signal }) {
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        // Same `-ss`/`-t` BEFORE `-i` rule as cutClip above (input-side trim).
        "-ss", String(startSec),
        "-t", String(Math.max(endSec - startSec, 0.01)),
        "-i", srcPath,
        "-acodec", "libmp3lame",
        "-q:a", "2",
        destPath,
      ],
      { timeout: CUT_TIMEOUT_MS, signal, maxBuffer: 1024 * 1024 * 10 }
    );
  } catch (err) {
    throwIfCancelled(err, signal);
  }
}

/**
 * Concatenates already-normalized clips (same resolution/fps/codec — see `cutClip`)
 * into one file via ffmpeg's concat demuxer with `-c copy` (no re-encode, since the
 * inputs are already uniform).
 * @param {object} params
 * @param {string[]} params.clipPaths - absolute paths, in order
 * @param {string} params.destPath
 * @param {AbortSignal} [params.signal]
 */
export async function concatClips({ clipPaths, destPath, signal }) {
  const listDir = mkdtempSync(join(tmpdir(), "ffmpeg-concat-"));
  const listPath = join(listDir, "list.txt");
  try {
    const listContent = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
    writeFileSync(listPath, listContent, "utf-8");
    try {
      await execFileAsync(
        "ffmpeg",
        ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", destPath],
        { timeout: CONCAT_TIMEOUT_MS, signal, maxBuffer: 1024 * 1024 * 10 }
      );
    } catch (err) {
      throwIfCancelled(err, signal);
    }
  } finally {
    rmSync(listDir, { recursive: true, force: true });
  }
}
