/**
 * Static film-grain texture for the "grain" scene effect — see
 * templates/sub-styles/image-full-focus.mjs.
 *
 * Root cause found live (user report: "tôi tích grain nhưng render không thấy gì
 * cả"): the first implementation used an inline `data:image/svg+xml` URI in CSS
 * `background-image`. Verified via `hyperframes snapshot` (the SAME capture engine
 * `render` uses) with a controlled before/after pixel-stats comparison: grain ON vs
 * grain OFF produced statistically IDENTICAL output (std ~17 either way — just the
 * base image's own natural gradient noise, not our overlay at all). Swapping the
 * exact same CSS to point at a real PNG file instead (no other change) immediately
 * showed clearly visible grain (std jumped to ~25, confirmed visually). Conclusion:
 * HyperFrames' render pipeline silently drops/ignores inline `data:` URIs in CSS
 * `background-image` — real asset files are required, same as fonts/images already
 * are in this pipeline.
 */
import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const GRAIN_SRC = join(ROOT, "assets", "grain", "grain-texture.png");

/** Copies the shared grain texture into `projectDir/assets/grain-texture.png`,
 *  idempotent — same convention as ensureFontCopied. */
export function ensureGrainCopied(projectDir) {
  const destDir = join(projectDir, "assets");
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, "grain-texture.png");
  if (!existsSync(dest)) copyFileSync(GRAIN_SRC, dest);
  return dest;
}
