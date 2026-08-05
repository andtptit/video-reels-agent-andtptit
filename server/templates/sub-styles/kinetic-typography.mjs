/**
 * "kinetic_typography" sub-style — text-IS-the-content full-screen animated
 * captions, no AI background image at all. Different from "image_full_focus" (chữ
 * chỉ là phụ đề nhỏ ở đáy, đè lên ảnh AI) — ở đây mỗi cụm từ chiếm toàn màn hình,
 * chuyển động mạnh, đổi liên tục theo giọng đọc, kiểu video "trend chữ" hay thấy
 * trên TikTok/Reels. Không cần sinh ảnh AI nên rẻ và nhanh hơn nhiều — xem
 * `needsImage = false` bên dưới, đọc bởi sub-scene-writer.mjs để bỏ qua toàn bộ
 * bước sinh/tái dùng ảnh cho style này.
 *
 * Deterministic (không LLM) — cùng lý do như image-full-focus.mjs: mọi giá trị ở
 * đây tính thẳng từ word_timestamps/sceneDuration, không có gì để model viết sai.
 *
 * 3 kiểu chuyển động xen kẽ theo thứ tự chunk (chunkIndex % 3) để đỡ nhàm mắt: pop
 * (phóng to), slide-up (trượt lên), slide-side (trượt ngang, đổi hướng theo scene
 * để 2 scene liền kề không lặp y hệt nhau). Animation vào/ra CHỈ nằm trong đúng
 * khung [chunk.start, chunk.end] của chính chunk đó — không cần tính toán chồng
 * lấn giữa các chunk (khác `image-full-focus.mjs`'s buffer +0.3s vì ở đây không có
 * hiệu ứng "chưa biến mất ngay" — chữ đổi dứt khoát mới hợp cảm giác "trend chữ").
 */
import { chunkWords } from "../../lib/caption-chunks.mjs";
import { fontFaceCss } from "../../lib/fonts.mjs";

export const id = "kinetic_typography";
export const label = "Kinetic Typography — chữ động toàn màn hình, không cần ảnh AI";
export const needsImage = false;

const BASE_COLOR = "#ffffff";
const HIGHLIGHT_COLOR = "#ffb020";
const DEFAULT_FONT = "Itim";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * @param {object} params
 * @param {string} params.compositionId
 * @param {string} params.classPrefix
 * @param {number} params.width
 * @param {number} params.height
 * @param {{word: string, start: number, end: number}[]} params.wordTimestamps
 * @param {number} params.sceneDuration
 * @param {string} [params.narration]
 * @param {string} [params.fontFamily]
 * @param {number} [params.sceneIndex] - 1-based scene number, dùng để chọn hướng
 *   trượt ngang luân phiên — sub-scene-writer.mjs truyền `n` (đã có sẵn từ
 *   sceneNumber(sceneId)).
 * @param {string} params.bgImagePath - project-relative path tới file gradient nền
 *   (xem lib/kinetic-bg.mjs) — BẮT BUỘC dùng file `<img>` thật, KHÔNG dùng CSS
 *   `background:` thuần: verify thật (real render, không phải `hyperframes
 *   snapshot`) rằng 1 composition không có phần tử media nào bị render bỏ qua toàn
 *   bộ CSS của chính nó — thêm `<img>` full-bleed (dù chỉ là gradient tĩnh) là cách
 *   duy nhất verify được sửa triệt để.
 * @returns {string} full standalone HTML document
 */
export function render({
  compositionId,
  classPrefix,
  width,
  height,
  wordTimestamps,
  sceneDuration,
  narration = "",
  fontFamily = DEFAULT_FONT,
  sceneIndex = 1,
  bgImagePath,
}) {
  const p = classPrefix;

  // Chữ chiếm toàn màn hình nên cần cụm NGẮN hơn nhiều so với phụ đề đáy (6 từ) —
  // 3 từ vừa đủ đọc trong 1 nhịp mắt ở cỡ chữ lớn.
  const fontSize = Math.round(width * 0.13);
  const strokeWidth = Math.max(2, Math.round(width * 0.004));

  const words = wordTimestamps.length ? wordTimestamps : [{ word: "", start: 0, end: sceneDuration }];
  const chunks = chunkWords(words, narration, { maxWordsPerChunk: 4 });

  let globalWordIndex = 0;
  const wordTweens = [];
  const chunkTweens = [];

  const chunkBlocks = chunks
    .map((chunk, chunkIndex) => {
      const chunkStart = chunk.start;
      const chunkDuration = Math.max(0.3, chunk.end - chunk.start);
      const spans = chunk.words
        .map((w) => {
          const i = globalWordIndex++;
          wordTweens.push(
            `tl.to("#${p}-w${i}", { color: "${HIGHLIGHT_COLOR}", duration: 0.05 }, ${w.start})` +
              `.to("#${p}-w${i}", { color: "${BASE_COLOR}", duration: 0.15 }, ${Math.max(w.end, w.start + 0.05)});`
          );
          return `<span id="${p}-w${i}" class="${p}-word">${escapeHtml(w.word)}</span>`;
        })
        .join(" ");

      // 3 kiểu vào xen kẽ theo chunkIndex; hướng trượt ngang đổi theo scene để 2
      // scene liền kề (nếu cùng rơi vào kiểu "slide-side") không lặp y hệt nhau.
      const motionType = chunkIndex % 3;
      const slideDir = sceneIndex % 2 === 0 ? 1 : -1;
      // Chunk ngắn (nói nhanh, cụm chỉ 1-2 từ) không đủ chỗ cho animation vào+ra cố
      // định 0.3s+0.2s — verify thật: 1 chunk 0.35s chỉ còn ~0.04s "đứng yên" trước
      // khi bắt đầu mờ đi, gần như không kịp đọc. Co giãn cả 2 theo chunkDuration
      // (tối đa 35%/25%) để luôn còn ít nhất ~40% thời lượng chunk đứng yên ở giữa.
      const enterDuration = Math.min(0.3, chunkDuration * 0.35);
      const exitDuration = Math.min(0.2, chunkDuration * 0.25);
      const fadeOutStart = chunkStart + chunkDuration - exitDuration;
      // GSAP animates the INNER (non-clip) wrapper, never the outer `class="clip"`
      // div itself — found live (real render, reproducible 100% of the time, not a
      // rare race): tweening opacity/transform directly on a clip-managed element
      // conflicts with the framework's own visibility handling and silently drops
      // ALL of this composition's CSS during the actual `render` capture (worked
      // fine in `hyperframes snapshot`, which is a different code path — that
      // discrepancy is exactly what exposed this). Same fix hyperframes lint itself
      // suggests for the "missing hard kill" finding: wrap in an inner div, animate
      // that instead, let the outer clip div's native show/hide alone.
      const innerId = `#${p}-chunk${chunkIndex}-inner`;
      if (motionType === 0) {
        chunkTweens.push(`tl.fromTo("${innerId}", { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: ${enterDuration}, ease: "back.out(1.7)" }, ${chunkStart});`);
      } else if (motionType === 1) {
        chunkTweens.push(`tl.fromTo("${innerId}", { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: ${enterDuration}, ease: "power2.out" }, ${chunkStart});`);
      } else {
        chunkTweens.push(`tl.fromTo("${innerId}", { x: ${60 * slideDir}, opacity: 0 }, { x: 0, opacity: 1, duration: ${enterDuration}, ease: "power2.out" }, ${chunkStart});`);
      }
      chunkTweens.push(`tl.to("${innerId}", { opacity: 0, scale: 0.92, duration: ${exitDuration}, ease: "power1.in" }, ${fadeOutStart});`);
      chunkTweens.push(`tl.set("${innerId}", { opacity: 0 }, ${chunkStart + chunkDuration});`);

      return `<div id="${p}-chunk${chunkIndex}" class="clip ${p}-chunk" data-start="${chunkStart}" data-duration="${chunkDuration}" data-track-index="1"><div id="${p}-chunk${chunkIndex}-inner" class="${p}-chunk-inner">${spans}</div></div>`;
    })
    .join("\n      ");

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

    .${p}-chunk {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      z-index: 1;
    }

    .${p}-chunk-inner {
      padding: 0 ${Math.round(width * 0.08)}px; text-align: center;
      font-size: ${fontSize}px; font-weight: 800; line-height: 1.25; color: ${BASE_COLOR};
      letter-spacing: 1px; -webkit-text-stroke: ${strokeWidth}px #000000; paint-order: stroke fill;
      text-shadow: 0 6px 14px rgba(0,0,0,0.35);
      opacity: 0;
    }

    .${p}-word { display: inline-block; }
  </style>
</head>
<body>
  <div id="${compositionId}" data-composition-id="${compositionId}" data-width="${width}" data-height="${height}">
    <img id="${p}-bg" class="clip" src="${bgImagePath}" data-start="0" data-duration="${sceneDuration}"
         data-track-index="0" alt=""
         style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0;">
    ${chunkBlocks}
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    ${chunkTweens.join("\n    ")}
    ${wordTweens.join("\n      ")}
    window.__timelines["${compositionId}"] = tl;
  </script>
</body>
</html>
`;
}
