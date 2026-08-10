/**
 * Shared, workspace-wide cache of aged-paper/map background textures for the
 * "investigation_board" sub-style — fetched from Pexels ONCE per fixed keyword, then
 * reused forever across every project (same "generic prop, cache once" reasoning
 * already applied to fonts/grain — see lib/fonts.mjs, lib/grain.mjs), unlike the
 * per-scene "hero" photo (topic-specific, fetched fresh per project via
 * providers/image/pexels.mjs directly).
 */
import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, resolve } from "path";
import { searchAndSavePhoto } from "../providers/image/pexels.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const TEXTURE_DIR = join(ROOT, "assets", "paper-textures");

// Small fixed set — enough visual variety without needing per-project fetches.
// Landscape orientation regardless of the video's own format: textures are cropped
// via CSS object-fit:cover in the composition, a wide source gives more room to crop.
const TEXTURE_KEYWORDS = ["vintage paper texture", "old world map texture", "aged parchment texture"];

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * Ensures the scene's chosen texture keyword is fetched into the shared cache
 * (idempotent — a keyword whose file already exists is never re-fetched, conserving
 * the free-tier rate limit), then copies it into `projectDir/assets/images/`.
 * @param {string} projectDir
 * @param {number} seed - picks which of TEXTURE_KEYWORDS to use, deterministically
 *   (e.g. scene number) — same scene always gets the same texture across re-renders.
 * @returns {Promise<string | null>} project-relative path, or null if Pexels has no
 *   matching photo yet for this keyword (caller should error, not fall back silently).
 */
export async function ensurePaperTextureCopied(projectDir, seed, { apiKey, signal } = {}) {
  mkdirSync(TEXTURE_DIR, { recursive: true });
  const keyword = TEXTURE_KEYWORDS[Math.abs(seed) % TEXTURE_KEYWORDS.length];
  const fileName = `${slug(keyword)}.jpg`;
  const cacheDest = join(TEXTURE_DIR, fileName);

  const result = await searchAndSavePhoto({ query: keyword, format: "16:9", destPath: cacheDest, apiKey, signal });
  if (!result.found) return null;

  const projDestName = `_paper-texture-${slug(keyword)}.jpg`;
  const projDestDir = join(projectDir, "assets", "images");
  mkdirSync(projDestDir, { recursive: true });
  const projDest = join(projDestDir, projDestName);
  if (!existsSync(projDest)) copyFileSync(cacheDest, projDest);
  return `assets/images/${projDestName}`;
}
