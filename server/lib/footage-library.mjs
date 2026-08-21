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
import { join, resolve, extname, isAbsolute } from "path";
import { probeDuration } from "../tools/ffmpeg-cli.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
export const FOOTAGE_LIBRARY_DIR = join(ROOT, "assets", "footage-library");

const VIDEO_EXTENSIONS = new Set([".mp4"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

// A custom `footageFolder` override (Hook.jsx's "Thư mục footage riêng") is commonly
// typed workspace-relative (matching how the shared pool's own default is shown
// everywhere as "assets/footage-library/") — found live (user report): this used to
// be passed straight to readdirSync/mkdirSync as-is, resolving against the SERVER
// PROCESS's cwd (server/, per package.json's `npm start`) instead of the workspace
// root, so a real folder always looked "not found". Resolve here once so every
// caller (scanFootageLibrary, pickRandomClips, and routes.mjs's own pre-check) agrees.
export function resolveLibraryDir(libraryDir) {
  return isAbsolute(libraryDir) ? libraryDir : join(ROOT, libraryDir);
}

/**
 * Lists sub-folders directly under `assets/footage-library/` — for a UI picker
 * ("Tạo biến thể"'s "Nguồn footage" dropdown) that needs to offer every footage set
 * a user has ever dropped in, not just the one folder a given profile happens to
 * point at. Returns workspace-relative paths (matching how `footageLibraryDir` is
 * typed/stored everywhere else, e.g. profile JSON's own field) so a picked value can
 * be written straight back into a profile/footageConfig without any conversion.
 */
export function listFootageSubfolders() {
  mkdirSync(FOOTAGE_LIBRARY_DIR, { recursive: true });
  return readdirSync(FOOTAGE_LIBRARY_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `assets/footage-library/${e.name}`)
    .sort();
}

// Same slug rules as new-project.mjs's own slugify() (lowercase, strip diacritics,
// non-alphanumeric collapsed to "-") — mirrors ProfileManager.jsx's client-side
// slugifyFolderName() used for the Pexels-fetch auto-naming, but re-done here too
// since the client's slug is untrusted input, not proof against a crafted name.
function slugifyFolderName(name) {
  return String(name ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "")
    .slice(0, 40);
}

/**
 * Explicitly creates (empty) a new sub-folder under assets/footage-library/ — for
 * "Hồ sơ kênh"'s "Tạo thư mục mới" control, so a user can set up a fresh folder to
 * drop new Pexels clips into BEFORE downloading anything, instead of only finding out
 * a folder exists once files are already in it. Scanning a folder (scanFootageLibrary)
 * already creates it as an mkdirSync side-effect, but that's incidental, not an
 * intentional "create" action a user should have to rely on.
 * @returns {string} the created folder's workspace-relative path
 */
export function createFootageSubfolder(name) {
  const slug = slugifyFolderName(name);
  if (!slug) throw new Error("Tên thư mục không hợp lệ (cần ít nhất 1 ký tự chữ/số)");
  const dir = join(FOOTAGE_LIBRARY_DIR, slug);
  mkdirSync(dir, { recursive: true });
  return `assets/footage-library/${slug}`;
}

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
  libraryDir = resolveLibraryDir(libraryDir);
  mkdirSync(libraryDir, { recursive: true });
  const files = readdirSync(libraryDir).filter((f) => {
    // "._foo.mp4" AppleDouble sidecar files (macOS resource-fork metadata, auto-created
    // when copying onto a non-HFS+ volume like this workspace's external drive) aren't
    // real media — ffprobe on one always fails with "moov atom not found".
    if (f.startsWith("._")) return false;
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
    } else if (cached && cached.mtimeMs === mtimeMs && cached.kind !== "image" && cached.durationSec != null) {
      durationSec = cached.durationSec;
    } else {
      try {
        durationSec = await probeDuration(filePath);
      } catch (err) {
        // A single corrupt/mislabeled file (real case hit live: a .mp4 that was
        // actually a raw JPEG with no container duration) must not take down the
        // whole pool — every other scene's clip-picking depends on this list.
        // Recorded with durationSec: null (not cached as a valid entry) so it's
        // excluded below but re-probed on every future scan instead of silently
        // staying broken forever if the user later fixes/replaces the file.
        console.warn(`[footage-library] Bỏ qua file lỗi (không đọc được duration): ${filePath} — ${err.message}`);
        durationSec = null;
      }
    }
    nextManifest[file] = { mtimeMs, durationSec, kind };
    if (kind === "image" || durationSec != null) result.push({ file, durationSec, kind });
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
  libraryDir = resolveLibraryDir(libraryDir);
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
