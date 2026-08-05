/**
 * "image_blur_card" sub-style — layout idea ported from Pixelle-Video's
 * `templates/1080x1920/image_blur_card.html` (a static `{{placeholder}}` template,
 * no animation/timing — a different engine entirely), re-implemented for HyperFrames:
 * the SAME AI image used twice — a full-bleed blurred copy as background, a sharp
 * SQUARE copy centered as the focal card — instead of Pixelle's single ordinary
 * full-bleed image. Karaoke sub-captions unchanged (see lib/karaoke-captions.mjs,
 * shared with image-full-focus.mjs), still pinned to the bottom of the WHOLE screen
 * (confirmed with user — not overlaid on the image card like Pixelle's original).
 *
 * Deliberately built from ONLY techniques already verified live and working in
 * image-full-focus.mjs — no CSS `background-image`, no `backdrop-filter`, no new
 * `display:flex` in `<style>`. This is a direct reaction to a real, still-unexplained
 * bug in "kinetic_typography" (see plan.md's "TẠM DỪNG" section): `hyperframes
 * render` (the real pipeline) mis-sized/mis-positioned that composition compared to
 * `hyperframes snapshot`, and the leading (unconfirmed) suspect was CSS on elements
 * without a real `<img>`'s "natural size". Both image layers here are real
 * `<img class="clip">` elements with `object-fit`, exactly image-full-focus.mjs's own
 * proven pattern — blur is a `filter:` on the `<img>` itself, not a background layer.
 */
import { renderKaraokeCaptions } from "../../lib/karaoke-captions.mjs";
import { fontFaceCss } from "../../lib/fonts.mjs";

export const id = "image_blur_card";
export const label = "Blur Card — ảnh vuông nổi bật + nền mờ cùng ảnh";
// Square image regardless of the video's own canvas format (9:16/16:9) — see
// sub-scene-writer.mjs's `imageFormat = style.imageAspect || format`.
export const imageAspect = "1:1";

const DEFAULT_FONT = "Itim"; // must match image-full-focus.mjs's own default

/**
 * @param {object} params
 * @param {string} params.compositionId - e.g. "scene-01"
 * @param {string} params.classPrefix - e.g. "s1" (no leading dot)
 * @param {number} params.width
 * @param {number} params.height
 * @param {string} params.imagePath - project-relative path to the pre-downloaded
 *   square AI image — reused for BOTH the blurred background and the sharp card.
 * @param {{word: string, start: number, end: number}[]} params.wordTimestamps
 * @param {number} params.sceneDuration - composition's data-duration
 * @param {string} [params.narration]
 * @param {string} [params.fontFamily]
 * @param {boolean} [params.kenBurns] - zoom-out nhẹ 1 -> 1.1, áp lên lớp ẢNH NÉT ở
 *   giữa (chủ thể chính) — KHÔNG áp lên lớp nền mờ, khác image-full-focus.mjs (ở đó
 *   chỉ có 1 lớp ảnh nên kenBurns áp thẳng lên nó).
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

  // Sharp card sized proportional to canvas width, capped so it (plus the caption
  // area below it) still fits comfortably above the bottom subtitle band.
  const cardSize = Math.round(width * 0.78);
  const cardTop = Math.round(height * 0.22);
  const cardRadius = Math.round(width * 0.04);

  const { css: captionCss, html: captionHtml, wordTweensJs } = renderKaraokeCaptions({
    classPrefix: p,
    width,
    height,
    wordTimestamps,
    sceneDuration,
    narration,
    trackIndex: 2, // tracks 0/1 taken by the two <img> layers below
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

    .${p}-bg-dim {
      position: absolute; inset: 0; background: rgba(0,0,0,0.25); z-index: 1;
    }

    .${p}-card-wrap {
      position: absolute; top: ${cardTop}px; left: 50%; transform: translateX(-50%);
      width: ${cardSize}px; height: ${cardSize}px; z-index: 2;
      border-radius: ${cardRadius}px; overflow: hidden;
      box-shadow: 0 ${Math.round(width * 0.02)}px ${Math.round(width * 0.07)}px rgba(0,0,0,0.45);
    }
    ${captionCss}

    .${p}-grain {
      position: absolute; inset: -2%; width: 104%; height: 104%;
      background-image: url("../assets/grain-texture.png");
      background-size: 256px 256px; background-repeat: repeat; opacity: 0.15;
      z-index: 4; pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="${compositionId}" data-composition-id="${compositionId}" data-width="${width}" data-height="${height}">
    <img id="${p}-bg-image" class="clip" src="${imagePath}" data-start="0" data-duration="${sceneDuration}"
         data-track-index="0" alt=""
         style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0; filter:blur(${Math.round(width * 0.022)}px) brightness(0.85); transform:scale(1.1);">
    <div class="${p}-bg-dim"></div>
    <div class="${p}-card-wrap">
      <img id="${p}-card-image" class="clip" src="${imagePath}" data-start="0" data-duration="${sceneDuration}"
           data-track-index="1" alt=""
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
