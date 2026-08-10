/**
 * "investigation_board" sub-style — aged paper/map background, a real stock photo
 * (Pexels, see providers/image/pexels.mjs) shown as a torn/scissor-cut rectangular
 * cutout (NOT a subject silhouette — the photo's own background stays intact inside
 * the jagged frame, same technique confirmed by re-analyzing a reference video: the
 * "cutout" is the whole photo cut out with scissors, not background-removed), taped
 * to the board, a small label tag, and an optional red-string+pin "evidence link" —
 * all pure CSS/SVG, no AI generation, no background-removal step anywhere.
 *
 * `imageSource = "stock-photo"` (not the boolean `needsImage`) is the signal
 * sub-scene-writer.mjs reads to fetch via Pexels instead of generateAndSaveImage —
 * kept as a separate field from `needsImage` (still just `true`/absent here) so the
 * two questions ("does this style need an image at all" vs "how does it acquire
 * one") stay independently answerable, matching kinetic_typography's own precedent
 * of `needsImage: false` being a single, narrow signal.
 *
 * Deliberately NOT LLM-authored (see sub-scene-writer.mjs) — every value here comes
 * from data (photo path, label text, word timestamps), same reasoning as every other
 * "sub" style.
 */
import { renderKaraokeCaptions } from "../../lib/karaoke-captions.mjs";
import { fontFaceCss } from "../../lib/fonts.mjs";

export const id = "investigation_board";
export const label = "Bảng điều tra — ảnh thật (Pexels) + giấy cũ + băng dán";
export const imageSource = "stock-photo";

const DEFAULT_FONT = "Itim";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Deterministic PRNG (seeded per-scene) — same torn-edge shape every re-render/retry
// of a given scene, but different scenes/videos still look varied from each other.
function seededRandom(seed) {
  let s = (seed || 1) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// CSS clip-path can only cut INTO a box, never extend past it — a torn-paper edge is
// approximated by jittering each side's points INWARD by a small random depth (never
// outward). segmentsPerSide=5 keeps the polygon cheap; this is a rough scissor-cut
// look, not a precision effect.
function tornEdgeClipPath(seed, segmentsPerSide = 5, maxJitterPercent = 2.2) {
  const rand = seededRandom(seed);
  const corners = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];
  const pts = [];
  for (let side = 0; side < 4; side++) {
    const [x1, y1] = corners[side];
    const [x2, y2] = corners[(side + 1) % 4];
    const isHorizontal = y1 === y2;
    for (let i = 0; i < segmentsPerSide; i++) {
      const t = i / segmentsPerSide;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      const jitter = i === 0 ? 0 : rand() * maxJitterPercent;
      const px = isHorizontal ? x : x + (x1 === 0 ? jitter : -jitter);
      const py = isHorizontal ? y + (y1 === 0 ? jitter : -jitter) : y;
      pts.push(`${px.toFixed(2)}% ${py.toFixed(2)}%`);
    }
  }
  return `polygon(${pts.join(", ")})`;
}

/**
 * @param {object} params
 * @param {string} params.compositionId - e.g. "scene-01"
 * @param {string} params.classPrefix - e.g. "s1" (no leading dot)
 * @param {number} params.width
 * @param {number} params.height
 * @param {string} params.imagePath - project-relative path to the downloaded Pexels photo
 * @param {string} params.paperTexturePath - project-relative path to the shared paper/map texture
 * @param {{word: string, start: number, end: number}[]} params.wordTimestamps
 * @param {number} params.sceneDuration
 * @param {string} [params.narration]
 * @param {string} [params.fontFamily]
 * @param {string} [params.labelText] - short tag near the photo (e.g. a place/date name)
 * @param {boolean} [params.showEvidenceLink] - draw a red string + pin from the photo
 *   to a second point, for scenes video-planner marks as "connects evidence"
 * @param {number} [params.sceneIndex] - drives the deterministic torn-edge shape + tilt
 * @returns {string} full standalone HTML document for compositions/scene_XX.html
 */
export function render({
  compositionId,
  classPrefix,
  width,
  height,
  imagePath,
  paperTexturePath,
  wordTimestamps,
  sceneDuration,
  narration = "",
  fontFamily = DEFAULT_FONT,
  labelText,
  showEvidenceLink = false,
  sceneIndex = 1,
}) {
  const p = classPrefix;
  const clipPath = tornEdgeClipPath(sceneIndex);

  // Photo shown as a "pinned-up cutout", not full-bleed — paper background shows
  // around it, slight deterministic tilt for a hand-placed look.
  const photoWidth = Math.round(width * 0.74);
  const photoHeight = Math.round(photoWidth * 0.62);
  const photoTop = Math.round(height * 0.16);
  const rotationDeg = ((sceneIndex * 37) % 7) - 3; // deterministic, -3..+3deg
  const tapeWidth = Math.round(photoWidth * 0.22);
  const tapeHeight = Math.round(width * 0.055);

  const stringX1 = Math.round(width * 0.22);
  const stringY1 = photoTop + photoHeight;
  const stringX2 = Math.round(width * 0.72);
  const stringY2 = photoTop + photoHeight + Math.round(height * 0.09);
  const stringLength = Math.round(Math.hypot(stringX2 - stringX1, stringY2 - stringY1));

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
    body { font-family: '${fontFamily}', sans-serif; position: relative; background: #2b2318; }

    #${compositionId} { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; }

    .${p}-paper {
      position: absolute; inset: -3%; width: 106%; height: 106%; object-fit: cover;
      filter: sepia(0.35) brightness(0.72) contrast(1.05);
    }
    .${p}-vignette {
      position: absolute; inset: 0; z-index: 1; pointer-events: none;
      background: radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%);
    }

    .${p}-photo-wrap {
      position: absolute; top: ${photoTop}px; left: 50%;
      width: ${photoWidth}px; height: ${photoHeight}px;
      transform: translateX(-50%) rotate(${rotationDeg}deg);
      z-index: 2; filter: drop-shadow(0 ${Math.round(height * 0.012)}px ${Math.round(height * 0.02)}px rgba(0,0,0,0.55));
    }
    .${p}-photo {
      display: block; width: 100%; height: 100%; object-fit: cover;
      clip-path: ${clipPath}; -webkit-clip-path: ${clipPath};
      filter: sepia(0.15) contrast(1.05);
    }
    .${p}-tape {
      position: absolute; width: ${tapeWidth}px; height: ${tapeHeight}px;
      background: rgba(230, 220, 190, 0.72); box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    }
    .${p}-tape-tl { top: -${Math.round(width * 0.02)}px; left: -${Math.round(tapeWidth * 0.2)}px; transform: rotate(-38deg); }
    .${p}-tape-br { bottom: -${Math.round(width * 0.02)}px; right: -${Math.round(tapeWidth * 0.2)}px; transform: rotate(-38deg); }

    .${p}-label {
      position: absolute; left: 8%; top: ${photoTop + photoHeight - Math.round(width * 0.03)}px; z-index: 3;
      background: #f4ecd8; color: #2b2318; font-weight: 800;
      font-size: ${Math.round(width * 0.032)}px; letter-spacing: 1px;
      padding: ${Math.round(width * 0.014)}px ${Math.round(width * 0.03)}px;
      transform: rotate(-2deg); box-shadow: 0 3px 6px rgba(0,0,0,0.4);
      border: 2px solid #2b2318;
    }

    .${p}-pin {
      position: absolute; width: ${Math.round(width * 0.03)}px; height: ${Math.round(width * 0.03)}px;
      border-radius: 50%; background: radial-gradient(circle at 35% 35%, #ff6b5b, #a3241a);
      box-shadow: 0 2px 4px rgba(0,0,0,0.5); z-index: 4;
      transform: translate(-50%, -50%);
    }

    ${captionCss}
  </style>
</head>
<body>
  <div id="${compositionId}" data-composition-id="${compositionId}" data-width="${width}" data-height="${height}">
    <img id="${p}-paper" class="clip ${p}-paper" src="${paperTexturePath}" data-start="0" data-duration="${sceneDuration}" data-track-index="0" alt="">
    <div class="${p}-vignette"></div>

    <div id="${p}-photo-wrap" class="clip ${p}-photo-wrap" data-start="0" data-duration="${sceneDuration}" data-track-index="2">
      <img class="${p}-photo" src="${imagePath}" alt="">
      <div class="${p}-tape ${p}-tape-tl"></div>
      <div class="${p}-tape ${p}-tape-br"></div>
    </div>

    ${
      labelText
        ? `<div id="${p}-label" class="clip ${p}-label" data-start="0.15" data-duration="${Math.max(sceneDuration - 0.15, 0.1)}" data-track-index="3">${escapeHtml(labelText)}</div>`
        : ""
    }

    ${
      showEvidenceLink
        ? `<svg id="${p}-string-svg" class="clip" data-start="0.3" data-duration="${Math.max(sceneDuration - 0.3, 0.1)}" data-track-index="4"
         style="position:absolute; inset:0; width:100%; height:100%; z-index:3; pointer-events:none;" viewBox="0 0 ${width} ${height}">
      <path id="${p}-string-path" d="M ${stringX1} ${stringY1} L ${stringX2} ${stringY2}"
            stroke="#c1272d" stroke-width="${Math.max(2, Math.round(width * 0.005))}" fill="none" stroke-linecap="round"/>
    </svg>
    <div id="${p}-pin" class="clip ${p}-pin" data-start="0.3" data-duration="${Math.max(sceneDuration - 0.3, 0.1)}" data-track-index="5"
         style="left:${stringX2}px; top:${stringY2}px;"></div>`
        : ""
    }

    ${captionHtml}
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#${p}-photo-wrap", { scale: 0.85, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: "back.out(1.6)" }, 0);
    ${labelText ? `tl.fromTo("#${p}-label", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3 }, 0.15);` : ""}
    ${
      showEvidenceLink
        ? `tl.fromTo("#${p}-string-path", { strokeDasharray: ${stringLength}, strokeDashoffset: ${stringLength} }, { strokeDashoffset: 0, duration: 0.5, ease: "power1.out" }, 0.3);
    tl.fromTo("#${p}-pin", { scale: 0 }, { scale: 1, duration: 0.2, ease: "back.out(2)" }, 0.6);`
        : ""
    }
    ${wordTweensJs}
    window.__timelines["${compositionId}"] = tl;
  </script>
</body>
</html>
`;
}
