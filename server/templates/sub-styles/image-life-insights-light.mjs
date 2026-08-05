/**
 * "image_life_insights_light" sub-style — layout idea ported from Pixelle-Video's
 * `templates/1080x1920/image_life_insights_light.html` (static `{{placeholder}}`
 * template, different engine — no animation/timing) into HyperFrames: warm cream
 * background with a subtle dot/grid texture + decorative circles (all pure CSS
 * gradients, no image asset), a SQUARE AI image centered, karaoke sub-captions
 * unchanged at the bottom of the whole screen (see lib/karaoke-captions.mjs, shared
 * with image-full-focus.mjs/image-blur-card.mjs). Pixelle's own `{{title}}` header is
 * dropped — this pipeline's scene data has no separate headline field (only
 * narration), and the user asked only to change the image/background, not add one.
 *
 * Same render-pipeline caution as image-blur-card.mjs: the AI image is a real
 * `<img class="clip">` with `object-fit`; the decorative background layer is plain
 * CSS gradients on a static (non-`clip`) div — the same category of element as
 * image-full-focus.mjs's own `.{p}-shade` (already verified stable through real
 * `hyperframes render`), just with different gradient content. No `backdrop-filter`,
 * no new `display:flex`.
 */
import { renderKaraokeCaptions } from "../../lib/karaoke-captions.mjs";
import { fontFaceCss } from "../../lib/fonts.mjs";

export const id = "image_life_insights_light";
export const label = "Life Insights Light — ảnh vuông + nền kem hoạ tiết";
// Square image regardless of the video's own canvas format — see
// sub-scene-writer.mjs's `imageFormat = style.imageAspect || format`.
export const imageAspect = "1:1";

const DEFAULT_FONT = "Itim"; // must match image-full-focus.mjs's own default
const BG_COLOR = "#F5F1E8";

/**
 * @param {object} params
 * @param {string} params.compositionId
 * @param {string} params.classPrefix
 * @param {number} params.width
 * @param {number} params.height
 * @param {string} params.imagePath - project-relative path to the pre-downloaded
 *   square AI image.
 * @param {{word: string, start: number, end: number}[]} params.wordTimestamps
 * @param {number} params.sceneDuration
 * @param {string} [params.narration]
 * @param {string} [params.fontFamily]
 * @param {boolean} [params.kenBurns] - zoom nhẹ áp lên ảnh vuông ở giữa.
 * @param {boolean} [params.grain]
 * @returns {string} full standalone HTML document for compositions/scene_XX.html
 */
export function render({
  compositionId,
  classPrefix,
  width,
  height,
  imagePath,
  wordTimestamps,
  sceneDuration,
  narration = "",
  fontFamily = DEFAULT_FONT,
  kenBurns = false,
  grain = false,
}) {
  const p = classPrefix;

  const imageSize = Math.round(width * 0.72);
  const imageTop = Math.round(height * 0.22);
  const imageRadius = Math.round(width * 0.03);

  const { css: captionCss, html: captionHtml, wordTweensJs } = renderKaraokeCaptions({
    classPrefix: p,
    width,
    height,
    wordTimestamps,
    sceneDuration,
    narration,
    trackIndex: 1, // track 0 taken by the single <img> layer below
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
    body { font-family: '${fontFamily}', sans-serif; position: relative; background: ${BG_COLOR}; }

    #${compositionId} { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: ${BG_COLOR}; }

    .${p}-bg-dots {
      position: absolute; inset: 0; z-index: 0;
      background-image: radial-gradient(circle, rgba(120,90,70,0.15) 1.5px, transparent 1.5px);
      background-size: 40px 40px;
    }

    .${p}-bg-circle {
      position: absolute; border-radius: 50%; z-index: 0;
      border: 1.5px solid rgba(110,85,65,0.15); background: rgba(140,110,90,0.08);
    }
    .${p}-bg-circle-1 { width: ${Math.round(width * 0.37)}px; height: ${Math.round(width * 0.37)}px; top: ${Math.round(height * -0.08)}px; right: ${Math.round(width * -0.09)}px; }
    .${p}-bg-circle-2 { width: ${Math.round(width * 0.28)}px; height: ${Math.round(width * 0.28)}px; bottom: ${Math.round(height * -0.05)}px; left: ${Math.round(width * -0.07)}px; }

    .${p}-image-wrap {
      position: absolute; top: ${imageTop}px; left: 50%; transform: translateX(-50%);
      width: ${imageSize}px; height: ${imageSize}px; z-index: 1;
      border-radius: ${imageRadius}px; overflow: hidden;
      box-shadow: 0 ${Math.round(width * 0.015)}px ${Math.round(width * 0.05)}px rgba(60,45,30,0.18);
    }
    ${captionCss}

    .${p}-grain {
      position: absolute; inset: -2%; width: 104%; height: 104%;
      background-image: url("../assets/grain-texture.png");
      background-size: 256px 256px; background-repeat: repeat; opacity: 0.12;
      z-index: 3; pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="${compositionId}" data-composition-id="${compositionId}" data-width="${width}" data-height="${height}">
    <div class="${p}-bg-dots"></div>
    <div class="${p}-bg-circle ${p}-bg-circle-1"></div>
    <div class="${p}-bg-circle ${p}-bg-circle-2"></div>
    <div class="${p}-image-wrap">
      <img id="${p}-card-image" class="clip" src="${imagePath}" data-start="0" data-duration="${sceneDuration}"
           data-track-index="0" alt=""
           style="width:100%; height:100%; object-fit:cover; display:block;">
    </div>
    ${captionHtml}
    ${grain ? `<div id="${p}-grain" class="${p}-grain"></div>` : ""}
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    ${kenBurns ? `tl.fromTo("#${p}-card-image", { scale: 1 }, { scale: 1.1, duration: ${sceneDuration}, ease: "none" }, 0);` : ""}
    ${
      grain
        ? `tl.fromTo("#${p}-grain", { backgroundPosition: "0px 0px" }, { backgroundPosition: "256px 256px", duration: ${sceneDuration}, ease: "none" }, 0);
    tl.to("#${p}-grain", { opacity: 0.20, duration: 0.07, ease: "steps(1)", repeat: ${Math.ceil((sceneDuration || 1) / 0.14)}, yoyo: true }, 0);`
        : ""
    }
    ${wordTweensJs}
    window.__timelines["${compositionId}"] = tl;
  </script>
</body>
</html>
`;
}
