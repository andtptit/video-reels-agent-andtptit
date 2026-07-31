/**
 * Maps a video-plan.json `format` string ("9:16" | "16:9") to canvas pixel
 * dimensions. Single source of truth so scene-writer.mjs and root-composer.mjs can't
 * silently disagree on target dimensions — confirmed live this was a real gap:
 * scene-writer's prompt never told the model what width/height to target, so scenes
 * generated in different sessions/orientations ended up with mismatched canvas sizes
 * (one scene 1080x1920, others 1920x1080) wired into the same root composition,
 * producing a video where that scene's content only fills a fraction of the frame.
 */
export const FORMAT_DIMENSIONS = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
};

export function dimensionsForFormat(format) {
  return FORMAT_DIMENSIONS[format] ?? FORMAT_DIMENSIONS["9:16"];
}
