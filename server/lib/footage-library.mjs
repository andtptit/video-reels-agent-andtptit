/**
 * Shared stock-footage pool for the "footage" template — a user-maintained folder of
 * `.mp4` files (hundreds, per user's own description), NOT scoped by channel profile
 * (unlike `image-library.mjs`, which is a per-profile "bank of AI-generated images to
 * reuse"). User drops files into `assets/footage-library/` directly via the file
 * system — same "shared workspace-level asset folder, manually populated" convention
 * as `assets/music`/`assets/sfx`/`assets/fonts`, no upload UI.
 *
 * `ffprobe`-derived durations are cached in `manifest.json` keyed by filename+mtime so
 * a project with many scenes doesn't re-probe the whole pool on every scene
 * generation — only new/changed files get probed.
 *
 * `libraryDir`/`includeImages` (both optional) let the "Đọc Caption" tab
 * (hook-scene-writer.mjs) point at a DIFFERENT, per-profile folder and mix in still
 * images — added without changing either function's default behavior at all: every
 * existing call site (agents/footage-scene-writer.mjs) omits both, so it keeps
 * scanning ONLY `FOOTAGE_LIBRARY_DIR` for ONLY `.mp4` files, byte-for-byte the same as
 * before this was generalized.
 */
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from "fs";
import { join, resolve, extname } from "path";
import { probeDuration } from "../tools/ffmpeg-cli.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
export const FOOTAGE_LIBRARY_DIR = join(ROOT, "assets", "footage-library");

const VIDEO_EXTENSIONS = new Set([".mp4"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function manifestPath(libraryDir) {
  return join(libraryDir, "manifest.json");
}

function readManifest(libraryDir) {
  const p = manifestPath(libraryDir);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function writeManifest(libraryDir, entries) {
  writeFileSync(manifestPath(libraryDir), JSON.stringify(entries, null, 2));
}

/**
 * Scans `libraryDir` (default the shared workspace pool) for `.mp4` files — plus
 * still images when `includeImages` is true — probing duration only for video files
 * that are new or changed (mtime differs from the cached manifest entry). Images
 * never get `ffprobe`d (a still has no source-length constraint the way a video clip
 * does) — their manifest/result entry carries `durationSec: null`.
 * @param {string} [libraryDir]
 * @param {object} [opts]
 * @param {boolean} [opts.includeImages]
 * @returns {Promise<{file: string, durationSec: number|null, kind: "video"|"image"}[]>}
 */
export async function scanFootageLibrary(libraryDir = FOOTAGE_LIBRARY_DIR, { includeImages = false } = {}) {
  mkdirSync(libraryDir, { recursive: true });
  const files = readdirSync(libraryDir).filter((f) => {
    const ext = extname(f).toLowerCase();
    return VIDEO_EXTENSIONS.has(ext) || (includeImages && IMAGE_EXTENSIONS.has(ext));
  });
  const manifest = readManifest(libraryDir);
  const nextManifest = {};
  const result = [];

  for (const file of files) {
    const filePath = join(libraryDir, file);
    const mtimeMs = statSync(filePath).mtimeMs;
    const kind = IMAGE_EXTENSIONS.has(extname(file).toLowerCase()) ? "image" : "video";
    const cached = manifest[file];
    let durationSec;
    if (kind === "image") {
      durationSec = null;
    } else if (cached && cached.mtimeMs === mtimeMs && cached.kind !== "image") {
      durationSec = cached.durationSec;
    } else {
      durationSec = await probeDuration(filePath);
    }
    nextManifest[file] = { mtimeMs, durationSec, kind };
    result.push({ file, durationSec, kind });
  }

  writeManifest(libraryDir, nextManifest);
  return result;
}

// --- Per-project "avoid reusing the same source file" tracking ---
// Best-effort only (not a hard cap like image-library's reuse budget) — with a pool
// of hundreds of files and typically 5-15 clip picks per video, collisions are rare;
// this just biases away from them when the pool is large enough to avoid one.
function usedFilesStatePath(projectDir) {
  return join(projectDir, "footage-used-state.json");
}

function readUsedFiles(projectDir) {
  const p = usedFilesStatePath(projectDir);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

function appendUsedFiles(projectDir, files) {
  const existing = readUsedFiles(projectDir);
  writeFileSync(usedFilesStatePath(projectDir), JSON.stringify([...existing, ...files], null, 2));
}

/**
 * Picks `count` random entries from the library, preferring files not already used in
 * this project (falls back to allowing repeats if the pool is smaller than `count`
 * unused entries). Records the picks so subsequent scenes in the same project keep
 * avoiding them too.
 * @param {object} params
 * @param {string} params.projectDir
 * @param {number} params.count
 * @param {string} [params.libraryDir]
 * @param {boolean} [params.includeImages]
 * @returns {Promise<{file: string, durationSec: number|null, kind: "video"|"image"}[]>}
 */
export async function pickRandomClips({ projectDir, count, libraryDir = FOOTAGE_LIBRARY_DIR, includeImages = false }) {
  const pool = await scanFootageLibrary(libraryDir, { includeImages });
  if (!pool.length) throw new Error(`Kho footage rỗng — thêm file vào ${libraryDir}`);

  const used = new Set(readUsedFiles(projectDir));
  const unused = pool.filter((e) => !used.has(e.file));
  const candidates = unused.length >= count ? unused : pool;

  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  const picks = shuffled.slice(0, count);
  appendUsedFiles(projectDir, picks.map((p) => p.file));
  return picks;
}
