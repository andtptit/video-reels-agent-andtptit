/**
 * Groups word-level timestamps into short on-screen caption chunks (a few words
 * each) instead of showing a whole scene's narration at once — confirmed live via a
 * real render that showing every word together produced 3 cramped lines on screen
 * simultaneously, unreadable for short-form video (user feedback + screenshot).
 *
 * Prefers splitting at real sentence boundaries pulled from `narration` (has
 * punctuation; word_timestamps from generate-audio.mjs doesn't carry punctuation
 * tokens — confirmed by reading real scenes-with-timing.json data) when the two
 * token counts line up 1:1. Falls back to a fixed max-words-per-chunk grouping
 * otherwise (e.g. the TTS engine merged/split a token differently than the raw text
 * tokenizes, so sentence-based counts wouldn't map cleanly onto word_timestamps) —
 * chunking must never throw or misalign even if that assumption doesn't hold.
 */
export function chunkWords(words, narration, { maxWordsPerChunk = 6 } = {}) {
  if (!words?.length) return [];

  const sentenceWordCounts = (narration ?? "")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+/).filter(Boolean).length);

  const alignmentOk = sentenceWordCounts.reduce((a, b) => a + b, 0) === words.length;

  const rawChunks = [];
  if (alignmentOk && sentenceWordCounts.length) {
    let i = 0;
    for (const count of sentenceWordCounts) {
      rawChunks.push(words.slice(i, i + count));
      i += count;
    }
  } else {
    rawChunks.push(words);
  }

  // Further split any chunk still too long (a single long sentence with no
  // punctuation, or the whole-words fallback above) into maxWordsPerChunk pieces.
  const chunks = [];
  for (const chunk of rawChunks) {
    for (let i = 0; i < chunk.length; i += maxWordsPerChunk) {
      chunks.push(chunk.slice(i, i + maxWordsPerChunk));
    }
  }

  return chunks.filter((c) => c.length).map((c) => ({ words: c, start: c[0].start, end: c[c.length - 1].end }));
}
