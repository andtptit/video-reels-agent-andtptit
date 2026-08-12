/**
 * Shared karaoke-caption rendering — factored out of templates/sub-styles/
 * image-full-focus.mjs so every "sub" subStyle that places captions at the bottom of
 * the full screen (image_full_focus, image_blur_card, image_life_insights_light)
 * shares byte-identical chunking/markup/tween logic instead of 3 copies that could
 * quietly drift apart. Logic here is a direct extraction — behavior unchanged.
 *
 * Captions are split into short chunks (chunkWords, see caption-chunks.mjs) — NOT one
 * block with every word of the scene visible at once. Confirmed live via a real
 * render + user screenshot: showing the whole narration together produced 3 cramped
 * lines on screen simultaneously, unreadable for short-form video. Each chunk div
 * gets `class="clip"` + `data-start`/`data-duration` spanning exactly its own words'
 * [first start, last end] — HyperFrames' clip visibility mechanism then shows only
 * one chunk on screen at a time with no extra GSAP needed for that part. Word spans
 * WITHIN a chunk still carry no `data-start`/`data-duration`/`class="clip"` of their
 * own (only a GSAP color tween) — they're already gated by their parent chunk's
 * visibility window.
 */
import { chunkWords } from "./caption-chunks.mjs";

export const BASE_COLOR = "#ffffff";
export const HIGHLIGHT_COLOR = "#ffb020";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * @param {object} params
 * @param {string} params.classPrefix - e.g. "s1" (no leading dot)
 * @param {number} params.width
 * @param {number} params.height
 * @param {{word: string, start: number, end: number}[]} params.wordTimestamps
 * @param {number} params.sceneDuration
 * @param {string} [params.narration] - full scene narration text (has punctuation,
 *   used to find real sentence boundaries for chunking — see caption-chunks.mjs)
 * @param {number} [params.trackIndex] - clip track for caption chunks. Default 1
 *   matches image_full_focus's existing convention (bg image on track 0); styles
 *   with more than one image layer must pass a track index past their own images'.
 * @returns {{css: string, html: string, wordTweensJs: string}}
 */
export function renderKaraokeCaptions({ classPrefix, width, height, wordTimestamps, sceneDuration, narration = "", trackIndex = 1 }) {
  const p = classPrefix;

  // Bumped from 0.046/0.073 — user compared against a competitor reference video
  // (caption sits noticeably higher and larger) and confirmed +30% font size /
  // +~92% bottom offset, applied to all 3 sub-styles since they share this helper.
  const fontSize = Math.round(width * 0.06);
  const strokeWidth = Math.max(2, Math.round(width * 0.0028));
  const sidePadding = Math.round(width * 0.074);
  const bottomPadding = Math.round(height * 0.14);

  const words = wordTimestamps.length ? wordTimestamps : [{ word: "", start: 0, end: sceneDuration }];
  const chunks = chunkWords(words, narration);

  let globalWordIndex = 0;
  const wordTweens = [];

  const chunkBlocks = chunks
    .map((chunk, chunkIndex) => {
      const chunkStart = chunk.start;
      // Extend slightly past the last word's end so the chunk doesn't vanish the
      // instant speech stops — matches the original per-word fade-back timing. Capped
      // at the NEXT chunk's start (confirmed live this was a real bug: two adjacent
      // chunks briefly showed on screen at once) because a flat +0.3s buffer wasn't
      // checked against the next chunk's start when chunks were closely spaced.
      const nextChunkStart = chunks[chunkIndex + 1]?.start ?? Infinity;
      const naturalEnd = Math.min(chunk.end + 0.3, nextChunkStart - 0.05);
      // Found live (user report): a flat `Math.max(0.3, ...)` minimum-visibility floor
      // ignored the SAME nextChunkStart cap `naturalEnd` above already respects — a
      // short chunk (e.g. a single quickly-spoken word) whose real gap to the next
      // chunk is under 0.35s got stretched to the 0.3s floor anyway, landing its end
      // past the next chunk's start and reproducing the exact overlap bug the cap
      // was added to prevent (lint's overlapping_clips_same_track — the same numbers
      // came out on every retry since this is deterministic code, not LLM variance).
      // Shrink the floor itself to fit whatever room is actually available before the
      // next chunk, down to a hard 0.05s minimum, instead of overriding the cap.
      const minDuration = Math.min(0.3, Math.max(nextChunkStart - chunkStart - 0.05, 0.05));
      const chunkDuration = Math.max(minDuration, naturalEnd - chunkStart);
      const spans = chunk.words
        .map((w) => {
          const i = globalWordIndex++;
          wordTweens.push(
            `tl.to("#${p}-w${i}", { color: "${HIGHLIGHT_COLOR}", scale: 1.08, duration: 0.05 }, ${w.start})` +
              `.to("#${p}-w${i}", { color: "${BASE_COLOR}", scale: 1, duration: 0.15 }, ${Math.max(w.end, w.start + 0.05)});`
          );
          return `<span id="${p}-w${i}" class="${p}-word">${escapeHtml(w.word)}</span>`;
        })
        .join(" ");
      // Same track-index for every chunk (not chunkIndex) — chunks never overlap in
      // time by construction, so they can safely reuse one track.
      return `<div id="${p}-chunk${chunkIndex}" class="clip ${p}-text" data-start="${chunkStart}" data-duration="${chunkDuration}" data-track-index="${trackIndex}">${spans}</div>`;
    })
    .join("\n      ");

  const css = `
    .${p}-subtitle-area { position: absolute; left: 0; right: 0; bottom: ${bottomPadding}px; padding: 0 ${sidePadding}px; text-align: center; z-index: 2; }

    .${p}-text {
      position: absolute; left: 0; right: 0; bottom: 0;
      font-size: ${fontSize}px; font-weight: 800; line-height: 1.6; color: ${BASE_COLOR};
      letter-spacing: 1px; -webkit-text-stroke: ${strokeWidth}px #000000; paint-order: stroke fill;
      text-shadow: 0 4px 10px rgba(0,0,0,0.4);
    }

    .${p}-word { display: inline-block; }`;

  const html = `<div class="${p}-subtitle-area">
      ${chunkBlocks}
    </div>`;

  return { css, html, wordTweensJs: wordTweens.join("\n      ") };
}
