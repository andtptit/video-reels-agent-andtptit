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
import { join } from "path";
import { tmpdir } from "os";
import { CancelledError } from "../jobs/cancel-registry.mjs";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 15_000;
const CUT_TIMEOUT_MS = 60_000;
const CONCAT_TIMEOUT_MS = 30_000;

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
 * @param {object} params
 * @param {string} params.srcPath
 * @param {string} params.destPath
 * @param {number} params.startSec - offset into the SOURCE file to start cutting
 * @param {number} params.outputDurationSec - desired duration of the OUTPUT clip
 * @param {number} params.width
 * @param {number} params.height
 * @param {boolean} [params.flip]
 * @param {number} [params.speedFactor] - e.g. 1.3 = 30% faster; omit/1 for no change.
 *   The RAW source cut is `outputDurationSec * speedFactor` seconds (caller must
 *   ensure the source has that much material available from `startSec`), sped up via
 *   `setpts` to land back on exactly `outputDurationSec`.
 * @param {AbortSignal} [params.signal]
 */
export async function cutClip({ srcPath, destPath, startSec, outputDurationSec, width, height, flip = false, speedFactor = 1, signal }) {
  const rawCutDurationSec = outputDurationSec * speedFactor;
  const filters = [`scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`];
  if (flip) filters.push("hflip");
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
        "-r", "30",
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
