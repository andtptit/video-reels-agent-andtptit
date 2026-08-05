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
 */
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { probeDuration } from "../tools/ffmpeg-cli.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
export const FOOTAGE_LIBRARY_DIR = join(ROOT, "assets", "footage-library");
const MANIFEST_PATH = join(FOOTAGE_LIBRARY_DIR, "manifest.json");

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return {};
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeManifest(entries) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(entries, null, 2));
}

/**
 * Scans `assets/footage-library/` for `.mp4` files, probing duration only for
 * files that are new or have changed (mtime differs from the cached manifest entry).
 * @returns {Promise<{file: string, durationSec: number}[]>}
 */
export async function scanFootageLibrary() {
  mkdirSync(FOOTAGE_LIBRARY_DIR, { recursive: true });
  const files = readdirSync(FOOTAGE_LIBRARY_DIR).filter((f) => f.toLowerCase().endsWith(".mp4"));
  const manifest = readManifest();
  const nextManifest = {};
  const result = [];

  for (const file of files) {
    const filePath = join(FOOTAGE_LIBRARY_DIR, file);
    const mtimeMs = statSync(filePath).mtimeMs;
    const cached = manifest[file];
    let durationSec;
    if (cached && cached.mtimeMs === mtimeMs) {
      durationSec = cached.durationSec;
    } else {
      durationSec = await probeDuration(filePath);
    }
    nextManifest[file] = { mtimeMs, durationSec };
    result.push({ file, durationSec });
  }

  writeManifest(nextManifest);
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
 * @returns {Promise<{file: string, durationSec: number}[]>}
 */
export async function pickRandomClips({ projectDir, count }) {
  const pool = await scanFootageLibrary();
  if (!pool.length) throw new Error(`Kho footage rỗng — thêm file .mp4 vào ${FOOTAGE_LIBRARY_DIR}`);

  const used = new Set(readUsedFiles(projectDir));
  const unused = pool.filter((e) => !used.has(e.file));
  const candidates = unused.length >= count ? unused : pool;

  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  const picks = shuffled.slice(0, count);
  appendUsedFiles(projectDir, picks.map((p) => p.file));
  return picks;
}
