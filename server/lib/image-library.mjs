/**
 * Reusable AI-image library — for "sub"/"ai-image" style videos, image generation is
 * the most expensive step in the pipeline (~$0.03/image per user's own measurement,
 * 5-7k VNĐ for a 7-10 scene video). Most of this workspace's content reuses similar
 * symbolic beats (hands, a note being passed, walking together...) across many
 * videos, so a scene whose `image_tags` (see video-planner.mjs's fixed
 * IMAGE_TAG_VOCAB) overlap enough with an already-generated image can reuse that
 * file instead of paying for a fresh generation.
 *
 * Scoped by `profileSlug` (a channel profile's stable id) + `format` (9:16 vs 16:9) —
 * NEVER by raw `imageStylePrefix` text, so a manually-retyped style (no profile
 * selected) never accidentally reuses images from an unrelated style, and switching
 * profiles (= switching house style) naturally starts a fresh pool instead of
 * mixing backgrounds from visually different styles into one video. Confirmed with
 * user before building: images generated with NO profile selected are one-off and
 * must never enter or read from the shared library.
 *
 * Storage: flat `assets/image-library/<id>.png` + `assets/image-library/manifest.json`
 * (array of entries) — same "shared workspace-level asset folder" convention as
 * assets/music, assets/sfx, assets/fonts.
 */
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { randomUUID } from "crypto";

const ROOT = resolve(import.meta.dirname, "..", "..");
const LIBRARY_DIR = join(ROOT, "assets", "image-library");
const MANIFEST_PATH = join(LIBRARY_DIR, "manifest.json");

// A scene's tags must overlap an existing entry's tags by at least this many to
// count as "close enough" to reuse — 2 chosen over "any overlap" (1) because a
// single shared tag out of 2-4 is often coincidental (e.g. both scenes tagged
// "smile-joy" but otherwise unrelated), while 2+ shared tags reliably means the
// same visual beat.
const MIN_TAG_OVERLAP = 2;

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return [];
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function writeManifest(entries) {
  mkdirSync(LIBRARY_DIR, { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(entries, null, 2));
}

function tagOverlapCount(a, b) {
  const setB = new Set(b);
  return a.filter((t) => setB.has(t)).length;
}

/**
 * @param {string[]} [excludeIds] - library entry ids to skip — see
 *   readUsedLibraryIds/recordUsedLibraryId below. Found live (user report): scene_01
 *   of a video generated a fresh image, got added to the shared library, and
 *   scene_03 of the SAME video (overlapping `image_tags`) immediately reused it —
 *   two scenes in ONE video showing the identical picture. The library exists to
 *   save cost ACROSS different videos, not to let sibling scenes of the same video
 *   collapse onto one image; excluding whatever this project has already used
 *   (fresh OR reused) keeps every scene in a video visually distinct.
 * @returns {{id: string, file: string}|null} the best-matching library entry for
 *   this profile+format+tags, or null if nothing clears MIN_TAG_OVERLAP.
 */
export function findReusableImage({ profileSlug, format, tags, excludeIds = [] }) {
  if (!profileSlug || !tags?.length) return null;
  const excluded = new Set(excludeIds);
  const entries = readManifest().filter((e) => e.profileSlug === profileSlug && e.format === format && !excluded.has(e.id));
  let best = null;
  let bestScore = MIN_TAG_OVERLAP - 1;
  for (const entry of entries) {
    const score = tagOverlapCount(tags, entry.tags ?? []);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

/** Copies `srcImagePath` into the shared library and records it in the manifest —
 *  call AFTER a real (non-skipped) generation succeeds. No-ops silently if
 *  `profileSlug` is missing (one-off manually-typed style, never persisted). */
export function addToLibrary({ profileSlug, format, tags, prompt, srcImagePath }) {
  if (!profileSlug || !tags?.length || !existsSync(srcImagePath)) return null;
  mkdirSync(LIBRARY_DIR, { recursive: true });
  const id = randomUUID();
  const file = `${id}.png`;
  copyFileSync(srcImagePath, join(LIBRARY_DIR, file));
  const entries = readManifest();
  entries.push({ id, file, profileSlug, format, tags, prompt, createdAt: new Date().toISOString() });
  writeManifest(entries);
  return { id, file };
}

/** Copies a library entry's image into a project's `destPath` (e.g.
 *  assets/images/scene_01.png) — mirrors generateAndSaveImage's return shape so
 *  callers don't need to branch on "reused vs freshly generated". */
export function copyFromLibrary(entry, destPath) {
  const src = join(LIBRARY_DIR, entry.file);
  copyFileSync(src, destPath);
  return { destPath, bytes: statSync(destPath).size, skipped: false, reusedFromLibrary: true };
}

// --- Per-project reuse budget (imageLibraryMaxReuse) + per-project "already used
// this library image" tracking (see findReusableImage's excludeIds doc comment) ---
// Both tracked in the SAME small per-project state file (not the shared library)
// since they're both "what has THIS video already done" facts, reset naturally by
// virtue of living inside the project dir.
function stateFilePath(projectDir) {
  return join(projectDir, "image-library-state.json");
}

function readState(projectDir) {
  const p = stateFilePath(projectDir);
  if (!existsSync(p)) return { reusedCount: 0, usedIds: [] };
  try {
    const state = JSON.parse(readFileSync(p, "utf-8"));
    return { reusedCount: state.reusedCount ?? 0, usedIds: state.usedIds ?? [] };
  } catch {
    return { reusedCount: 0, usedIds: [] };
  }
}

function writeState(projectDir, state) {
  writeFileSync(stateFilePath(projectDir), JSON.stringify(state, null, 2));
}

/** Returns true (and reserves 1 slot) if this project hasn't hit `maxReuse` yet —
 *  call BEFORE actually reusing an image, so a maxReuse of e.g. 2 across scenes
 *  generated one-by-one never over-commits past the cap. `maxReuse: null` means no
 *  cap (always allowed). */
export function tryReserveReuseSlot(projectDir, maxReuse) {
  if (maxReuse === null || maxReuse === undefined) return true;
  const state = readState(projectDir);
  if (state.reusedCount >= maxReuse) return false;
  writeState(projectDir, { ...state, reusedCount: state.reusedCount + 1 });
  return true;
}

/** Every library image id this project has already used (freshly generated-then-
 *  banked, or reused from another video) — pass as findReusableImage's
 *  `excludeIds` so no two scenes of the same video ever collapse onto one image. */
export function readUsedLibraryIds(projectDir) {
  return readState(projectDir).usedIds;
}

/** Records `id` as used by this project — call after EITHER a fresh generation gets
 *  banked via addToLibrary (its returned id) OR an existing entry gets reused via
 *  findReusableImage (that entry's own id), so both paths feed the same exclusion
 *  list for this project's remaining scenes. */
export function recordUsedLibraryId(projectDir, id) {
  if (!id) return;
  const state = readState(projectDir);
  if (state.usedIds.includes(id)) return;
  writeState(projectDir, { ...state, usedIds: [...state.usedIds, id] });
}
