/**
 * "image_full_focus" sub-style — ported from Pixelle-Video's
 * `data/templates/1080x1920/image_full_focus.html` (full-bleed AI image + gradient
 * shade + subtitle block near the bottom) into a HyperFrames sub-composition, with
 * the static `{{text}}` block replaced by per-word `<span>`s driven by real
 * word-level timestamps (`_audio.word_timestamps` from generate-audio.mjs) instead
 * of Pixelle's manually-authored `<span class="highlight">`.
 *
 * Deliberately NOT LLM-authored (see sub-scene-writer.mjs) — every value here comes
 * straight from data (image path, word start/end times, canvas size), so there's
 * nothing for a model to get wrong.
 *
 * Captions are split into short chunks (chunkWords, see lib/caption-chunks.mjs) —
 * NOT one block with every word of the scene visible at once. Confirmed live via a
 * real render + user screenshot: showing the whole narration together produced 3
 * cramped lines on screen simultaneously, unreadable for short-form video. Each
 * chunk div gets `class="clip"` + `data-start`/`data-duration` spanning exactly its
 * own words' [first start, last end] — HyperFrames' clip visibility mechanism then
 * shows only one chunk on screen at a time with no extra GSAP needed for that part.
 * Word spans WITHIN a chunk still carry no `data-start`/`data-duration`/`class="clip"`
 * of their own (only a GSAP color tween) — they're already gated by their parent
 * chunk's visibility window.
 */
import { renderKaraokeCaptions } from "../../lib/karaoke-captions.mjs";
import { fontFaceCss } from "../../lib/fonts.mjs";

export const id = "image_full_focus";
export const label = "Full Focus — ảnh full-bleed + sub karaoke đáy";

// "Itim" default — confirmed via Google Fonts metadata API (fonts.google.com/metadata/fonts/Itim)
// to declare a `vietnamese` coverage subset with full diacritic codepoints, unlike
// the previous hardcoded "Baloo 2"/"Be Vietnam Pro" pairing which was never actually
// verified for Vietnamese support before being hardcoded here.
const DEFAULT_FONT = "Itim";

/**
 * @param {object} params
 * @param {string} params.compositionId - e.g. "scene-01"
 * @param {string} params.classPrefix - e.g. "s1" (no leading dot)
 * @param {number} params.width
 * @param {number} params.height
 * @param {string} params.imagePath - project-relative path to the pre-downloaded AI image
 * @param {{word: string, start: number, end: number}[]} params.wordTimestamps
 * @param {number} params.sceneDuration - composition's data-duration
 * @param {string} [params.narration] - full scene narration text (has punctuation,
 *   used to find real sentence boundaries for chunking — see caption-chunks.mjs)
 * @param {string} [params.fontFamily] - Google Fonts family name, must support
 *   Vietnamese (verify via fonts.google.com/metadata/fonts/<name> before adding a
 *   new option to FONT_WEIGHTS above)
 * @param {boolean} [params.kenBurns] - zoom-out nhẹ 1 -> 1.1 trên ảnh nền, chạy suốt
 *   sceneDuration bằng GSAP linear tween. Chỉ ảnh nền bị ảnh hưởng — shade/subtitle là
 *   lớp riêng nằm ngoài phần tử được scale nên không bị kéo giãn theo.
 * @param {boolean} [params.grain] - lớp film-grain/scratch CHUYỂN ĐỘNG phủ toàn khung
 *   hình, dùng file PNG texture thật (`../assets/grain-texture.png`, copy vào project
 *   bằng ensureGrainCopied — xem lib/grain.mjs) — KHÔNG dùng data: URI inline: verify
 *   thật bằng hyperframes snapshot rằng HyperFrames' render pipeline âm thầm bỏ qua
 *   data: URI trong background-image (grain ON/OFF cho pixel-stats giống hệt nhau khi
 *   dùng data URI, real file thì khác biệt rõ). Không dùng mix-blend-mode: overlay
 *   (verify thật: gần như vô hiệu trên nền rất sáng/rất tối, đúng chất liệu pastel của
 *   DESIGN.md này) — chỉ alpha blend thuần qua opacity. 2 GSAP tween: (1) texture trôi
 *   liên tục qua backgroundPosition suốt sceneDuration (tile lặp nên trôi liền mạch,
 *   không đứt đoạn), (2) opacity nhấp nháy nhanh (steps easing, không mượt — kiểu
 *   "rung sáng" phim cũ) giữa base 0.15 và 0.20. Độc lập với kenBurns.
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
  grain = false, // static film-grain/scratch overlay, independent of kenBurns
  // (different layer entirely — can combine freely with any other effect)
}) {
  const p = classPrefix;

  // Proportional to canvas size (not hardcoded 1080x1920 px like the Pixelle
  // original) so the same style works for both 9:16 and 16:9 without a second file.
  const shadeHeight = Math.round(height * 0.27);

  const { css: captionCss, html: captionHtml, wordTweensJs } = renderKaraokeCaptions({
    classPrefix: p,
    width,
    height,
    wordTimestamps,
    sceneDuration,
    narration,
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

    .${p}-grain {
      position: absolute; inset: -2%; width: 104%; height: 104%;
      background-image: url("../assets/grain-texture.png");
      background-size: 256px 256px; background-repeat: repeat; opacity: 0.15;
      z-index: 3; pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="${compositionId}" data-composition-id="${compositionId}" data-width="${width}" data-height="${height}">
    <img id="${p}-bg-image" class="clip" src="${imagePath}" data-start="0" data-duration="${sceneDuration}"
         data-track-index="0" alt=""
         style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0;">
    <div class="${p}-shade"></div>
    ${captionHtml}
    ${grain ? `<div id="${p}-grain" class="${p}-grain"></div>` : ""}
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    ${kenBurns ? `tl.fromTo("#${p}-bg-image", { scale: 1 }, { scale: 1.1, duration: ${sceneDuration}, ease: "none" }, 0);` : ""}
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
