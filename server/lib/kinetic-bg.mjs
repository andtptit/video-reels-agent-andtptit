/**
 * Static background gradient PNGs for the "kinetic_typography" sub-style — see its
 * own doc comment for the full story. Real `<img class="clip">` files, not CSS
 * `background:`, because a real render (not `hyperframes snapshot`, a different
 * capture path) was verified live to leave a composition's CSS entirely unapplied
 * when it has zero media elements — a full-bleed `<img>` is this codebase's already-
 * proven pattern (every "sub" style scene has one) for getting a composition
 * correctly sized/painted through the real render pipeline.
 */
import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const BG_DIR = join(ROOT, "assets", "kinetic-bg");
export const KINETIC_BG_COUNT = 2;

/** Copies bg-{index % KINETIC_BG_COUNT}.png into projectDir/assets/images/ under a
 *  scene-specific name, idempotent — same convention as ensureGrainCopied. Returns
 *  the project-relative path to reference from the composition. */
export function ensureKineticBgCopied(projectDir, sceneNum, index) {
  const variant = index % KINETIC_BG_COUNT;
  const destName = `_kinetic-bg-${sceneNum}.png`;
  const destDir = join(projectDir, "assets", "images");
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, destName);
  if (!existsSync(dest)) copyFileSync(join(BG_DIR, `bg-${variant}.png`), dest);
  return `assets/images/${destName}`;
}
