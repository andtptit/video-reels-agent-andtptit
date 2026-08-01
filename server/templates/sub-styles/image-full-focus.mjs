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
 * nothing for a model to get wrong. Word spans carry no `data-start`/`data-duration`/
 * `class="clip"`: they're rendered visible for the whole scene (CLAUDE.md's "elements
 * WITH TIMING need class=clip" doesn't apply — these have no entrance/exit, only a
 * color tween), matching how HyperFrames' clip mechanism is scoped to visibility
 * gating, not general animation.
 */
export const id = "image_full_focus";
export const label = "Full Focus — ảnh full-bleed + sub karaoke đáy";

const BASE_COLOR = "#ffffff";
const HIGHLIGHT_COLOR = "#ffb020";
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Be+Vietnam+Pro:wght@600;700;800&display=swap";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * @param {object} params
 * @param {string} params.compositionId - e.g. "scene-01"
 * @param {string} params.classPrefix - e.g. "s1" (no leading dot)
 * @param {number} params.width
 * @param {number} params.height
 * @param {string} params.imagePath - project-relative path to the pre-downloaded AI image
 * @param {{word: string, start: number, end: number}[]} params.wordTimestamps
 * @param {number} params.sceneDuration - composition's data-duration
 * @returns {string} full standalone HTML document for compositions/scene_XX.html
 */
export function render({ compositionId, classPrefix, width, height, imagePath, wordTimestamps, sceneDuration }) {
  const p = classPrefix;

  // Proportional to canvas size (not hardcoded 1080x1920 px like the Pixelle
  // original) so the same style works for both 9:16 and 16:9 without a second file.
  const fontSize = Math.round(width * 0.046);
  const strokeWidth = Math.max(2, Math.round(width * 0.0028));
  const sidePadding = Math.round(width * 0.074);
  const bottomPadding = Math.round(height * 0.073);
  const shadeHeight = Math.round(height * 0.27);

  const words = wordTimestamps.length ? wordTimestamps : [{ word: "", start: 0, end: sceneDuration }];

  const wordSpans = words
    .map((w, i) => `<span id="${p}-w${i}" class="${p}-word">${escapeHtml(w.word)}</span>`)
    .join(" ");

  const wordTweens = words
    .map(
      (w, i) =>
        `tl.to("#${p}-w${i}", { color: "${HIGHLIGHT_COLOR}", scale: 1.08, duration: 0.05 }, ${w.start})` +
        `.to("#${p}-w${i}", { color: "${BASE_COLOR}", scale: 1, duration: 0.15 }, ${Math.max(w.end, w.start + 0.05)});`
    )
    .join("\n      ");

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=${width}, height=${height}">
  <title>${compositionId}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${FONTS_HREF}" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
    body { font-family: 'Baloo 2', 'Be Vietnam Pro', sans-serif; position: relative; background: #000; }

    #${compositionId} { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; }

    .${p}-shade {
      position: absolute; left: 0; right: 0; bottom: 0; height: ${shadeHeight}px;
      background: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 65%, rgba(0,0,0,0.7) 100%);
      z-index: 1;
    }

    .${p}-subtitle-area { position: absolute; left: 0; right: 0; bottom: ${bottomPadding}px; padding: 0 ${sidePadding}px; text-align: center; z-index: 2; }

    .${p}-text {
      font-size: ${fontSize}px; font-weight: 800; line-height: 1.6; color: ${BASE_COLOR};
      letter-spacing: 1px; -webkit-text-stroke: ${strokeWidth}px #000000; paint-order: stroke fill;
      text-shadow: 0 4px 10px rgba(0,0,0,0.4);
    }

    .${p}-word { display: inline-block; }
  </style>
</head>
<body>
  <div id="${compositionId}" data-composition-id="${compositionId}" data-width="${width}" data-height="${height}">
    <img id="${p}-bg-image" class="clip" src="${imagePath}" data-start="0" data-duration="${sceneDuration}"
         data-track-index="0" alt=""
         style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0;">
    <div class="${p}-shade"></div>
    <div class="${p}-subtitle-area">
      <div class="${p}-text">${wordSpans}</div>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    ${wordTweens}
    window.__timelines["${compositionId}"] = tl;
  </script>
</body>
</html>
`;
}
