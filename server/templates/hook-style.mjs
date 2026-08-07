/**
 * "Đọc Caption" tab's only composition style — a blurred full-bleed footage
 * background (already cut/normalized/concatenated into one file by
 * hook-scene-writer.mjs, same convention as footage-style.mjs) + a STATIC text card:
 * hook headline (1 word/phrase highlighted), a "Mình chỉ thay đổi N {topic}" line, and
 * a CTA. No voiceover, no per-word timing — everything is visible for the scene's
 * whole duration with a simple one-time staggered entrance, unlike karaoke-captions.mjs
 * (that module's entire purpose — chunking/tweening word-by-word against real
 * `wordTimestamps` — doesn't apply when there's no audio to sync to).
 *
 * Blur is `filter:blur()` directly on the `<video class="clip">` element (matches
 * image-blur-card.mjs's proven-through-real-render pattern) — deliberately NOT
 * `backdrop-filter` (flagged as a render-risk resembling the still-unexplained
 * Kinetic Typography bug, see plan.md).
 */
import { fontFaceCss } from "../lib/fonts.mjs";

export const id = "hook";
export const label = "Đọc Caption — hook card trên nền video mờ";

const DEFAULT_FONT = "Itim";
const DEFAULT_HIGHLIGHT_COLOR = "#ffb020"; // matches karaoke-captions.mjs's HIGHLIGHT_COLOR for visual consistency
// 48 reproduces the ORIGINAL hardcoded value (width*0.024) exactly — width*(48/100)*0.05
// = width*0.024 — so upgrading existing projects/profiles with no saved blurPercent
// yet doesn't silently change how they already looked.
const DEFAULT_BLUR_PERCENT = 48;

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * @param {object} params
 * @param {string} params.compositionId - e.g. "scene-01"
 * @param {string} params.classPrefix - e.g. "s1" (no leading dot)
 * @param {number} params.width
 * @param {number} params.height
 * @param {string} params.videoPath - project-relative path to the pre-cut, pre-concat
 *   footage clip (assets/footage/scene_01.mp4), already normalized to width×height.
 * @param {number} params.sceneDuration - composition's data-duration (= whole video)
 * @param {string} params.hook - headline text
 * @param {string} [params.highlightWord] - substring of `hook` to color; if it isn't
 *   found verbatim, the headline just renders with no highlight (fail-soft — see
 *   hook-content-writer.mjs's own note on this).
 * @param {number} params.count
 * @param {string} params.topic
 * @param {string} [params.ctaText]
 * @param {string} [params.highlightColor]
 * @param {number} [params.blurPercent] - 0-100 (0 = sharp/no blur, 100 = very blurred)
 * @param {string} [params.fontFamily]
 * @returns {string} full standalone HTML document for compositions/scene_01.html
 */
export function render({
  compositionId,
  classPrefix,
  width,
  height,
  videoPath,
  sceneDuration,
  hook,
  highlightWord,
  count,
  topic,
  ctaText = "ĐỌC CAPTION",
  highlightColor = DEFAULT_HIGHLIGHT_COLOR,
  blurPercent = DEFAULT_BLUR_PERCENT,
  fontFamily = DEFAULT_FONT,
}) {
  const p = classPrefix;
  const blurPx = Math.round(width * (blurPercent / 100) * 0.05);

  const escapedHook = escapeHtml(hook);
  const escapedHighlight = highlightWord ? escapeHtml(highlightWord) : "";
  const hookHtml =
    escapedHighlight && escapedHook.includes(escapedHighlight)
      ? escapedHook.replace(escapedHighlight, `<span class="${p}-highlight">${escapedHighlight}</span>`)
      : escapedHook;

  const hookFontSize = Math.round(width * 0.088);
  const sublineFontSize = Math.round(width * 0.052);
  const ctaFontSize = Math.round(width * 0.05);
  const sidePadding = Math.round(width * 0.09);
  const hookTop = Math.round(height * 0.27);
  const sublineTop = Math.round(height * 0.46);
  const ctaTop = Math.round(height * 0.56);

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

    .${p}-dim { position: absolute; inset: 0; background: rgba(0,0,0,0.25); z-index: 1; }

    .${p}-text-wrap { position: absolute; inset: 0; z-index: 2; }

    .${p}-hook, .${p}-subline, .${p}-cta {
      position: absolute; left: 0; right: 0; text-align: center;
      padding: 0 ${sidePadding}px; color: #ffffff;
    }
    .${p}-hook {
      top: ${hookTop}px; font-size: ${hookFontSize}px; font-weight: 800; line-height: 1.3;
      letter-spacing: 0.5px; text-shadow: 0 4px 14px rgba(0,0,0,0.5);
    }
    .${p}-highlight { color: ${highlightColor}; }
    .${p}-subline {
      top: ${sublineTop}px; font-size: ${sublineFontSize}px; font-weight: 700; line-height: 1.5;
      text-shadow: 0 3px 10px rgba(0,0,0,0.45);
    }
    .${p}-cta {
      top: ${ctaTop}px; font-size: ${ctaFontSize}px; font-weight: 800; letter-spacing: 2px;
      text-shadow: 0 3px 10px rgba(0,0,0,0.45);
    }
  </style>
</head>
<body>
  <div id="${compositionId}" data-composition-id="${compositionId}" data-width="${width}" data-height="${height}">
    <video id="${p}-bg-video" class="clip" src="${videoPath}" data-start="0" data-duration="${sceneDuration}"
           data-track-index="0" muted playsinline
           style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0; filter:blur(${blurPx}px) brightness(0.85); transform:scale(1.12);"></video>
    <div class="${p}-dim"></div>
    <div class="clip ${p}-text-wrap" data-start="0" data-duration="${sceneDuration}" data-track-index="1">
      <div class="${p}-hook">${hookHtml}</div>
      <div class="${p}-subline">Mình chỉ thay đổi<br>${escapeHtml(count)} ${escapeHtml(topic)}</div>
      <div class="${p}-cta">${escapeHtml(ctaText)}</div>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.from(".${p}-hook", { opacity: 0, y: 24, duration: 0.5, ease: "power2.out" }, 0);
    tl.from(".${p}-subline", { opacity: 0, y: 20, duration: 0.5, ease: "power2.out" }, 0.25);
    tl.from(".${p}-cta", { opacity: 0, y: 16, duration: 0.5, ease: "power2.out" }, 0.5);
    window.__timelines["${compositionId}"] = tl;
  </script>
</body>
</html>
`;
}
