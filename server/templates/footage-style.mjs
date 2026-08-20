/**
 * "footage" template's only composition style — full-bleed local stock-footage clip
 * (already cut/normalized/concatenated into one file by footage-scene-writer.mjs) +
 * karaoke sub-captions, same bottom-of-screen placement as image-full-focus.mjs.
 *
 * Deliberately mirrors image-full-focus.mjs's structure as closely as possible — that
 * style has been the most proven-stable through real `hyperframes render` (not just
 * snapshot) all session. Only real difference: `<video muted playsinline>` instead of
 * `<img>`. No `<audio>` companion element — the footage clip has no audio track at all
 * (ffmpeg-cli.mjs's `cutClip` always strips it with `-an`), and the scene's real
 * narration audio is mounted separately by root-composer like every other template.
 * No kenBurns (the footage already has its own motion, unlike a static AI image) and
 * no grain — not part of `footageConfig`, kept out of scope for this template's v1.
 */
import { renderKaraokeCaptions } from "../lib/karaoke-captions.mjs";
import { fontFaceCss } from "../lib/fonts.mjs";

export const id = "footage";
export const label = "Footage — video thật ghép ngẫu nhiên + sub karaoke";

const DEFAULT_FONT = "Itim"; // must match templates/sub-styles/image-full-focus.mjs's own default

/**
 * @param {object} params
 * @param {string} params.compositionId - e.g. "scene-01"
 * @param {string} params.classPrefix - e.g. "s1" (no leading dot)
 * @param {number} params.width
 * @param {number} params.height
 * @param {string} params.videoPath - project-relative path to the pre-cut, pre-concat
 *   footage clip (assets/footage/scene_XX.mp4), already normalized to width×height.
 * @param {{word: string, start: number, end: number}[]} params.wordTimestamps
 * @param {number} params.sceneDuration - voice/caption portion only. Captions are
 *   sized against this — NOT `videoDuration` below — so nothing lingers on screen
 *   during a trailing SFX beat that has no narration of its own.
 * @param {number} [params.videoDuration] - the footage clip's own data-duration,
 *   defaults to `sceneDuration`. Longer than `sceneDuration` when this scene has a
 *   "SFX cuối scene" reaction sound (see footage-scene-writer.mjs's own doc comment):
 *   the clip is cut that much longer so it keeps rolling under the sound instead of
 *   freezing/going blank once captions end.
 * @param {string} [params.narration]
 * @param {string} [params.fontFamily]
 * @param {"bottom"|"center"} [params.captionPosition] - see karaoke-captions.mjs's
 *   own doc comment on `position`.
 * @returns {string} full standalone HTML document for compositions/scene_XX.html
 */
export function render({
  compositionId,
  classPrefix,
  width,
  height,
  videoPath,
  wordTimestamps,
  sceneDuration,
  videoDuration = sceneDuration,
  narration = "",
  fontFamily = DEFAULT_FONT,
  captionPosition = "bottom",
}) {
  const p = classPrefix;
  const shadeHeight = Math.round(height * 0.27);

  const { css: captionCss, html: captionHtml, wordTweensJs } = renderKaraokeCaptions({
    classPrefix: p,
    width,
    height,
    wordTimestamps,
    sceneDuration,
    narration,
    position: captionPosition,
  });

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=${width}, height=${height}">
  <title>${compositionId}</title>
  <style>
    ${fontFaceCss(fontFamily)}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
    body { font-family: '${fontFamily}', sans-serif; position: relative; background: #000; }

    #${compositionId} { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; }

    .${p}-shade {
      position: absolute; left: 0; right: 0; bottom: 0; height: ${shadeHeight}px;
      background: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 65%, rgba(0,0,0,0.7) 100%);
      z-index: 1;
    }
    ${captionCss}
  </style>
</head>
<body>
  <div id="${compositionId}" data-composition-id="${compositionId}" data-width="${width}" data-height="${height}">
    <video id="${p}-bg-video" class="clip" src="${videoPath}" data-start="0" data-duration="${videoDuration}"
           data-track-index="0" muted playsinline
           style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0;"></video>
    <div class="${p}-shade"></div>
    ${captionHtml}
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    ${wordTweensJs}
    window.__timelines["${compositionId}"] = tl;
  </script>
</body>
</html>
`;
}
