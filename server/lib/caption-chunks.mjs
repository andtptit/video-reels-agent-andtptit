/**
 * Groups word-level timestamps into short on-screen caption chunks (a few words
 * each) instead of showing a whole scene's narration at once — confirmed live via a
 * real render that showing every word together produced 3 cramped lines on screen
 * simultaneously, unreadable for short-form video (user feedback + screenshot).
 *
 * Prefers splitting at real sentence boundaries pulled from `narration` (has
 * punctuation; word_timestamps from generate-audio.mjs doesn't carry punctuation
 * tokens — confirmed by reading real scenes-with-timing.json data). The two word
 * lists don't always have the same count — the TTS engine occasionally speaks 2
 * narration words as 1 token (or vice versa: a number, a contraction, a compound —
 * confirmed live across real projects: ~16% of multi-sentence scenes had an exact
 * 1-word total mismatch). `alignNarrationToWords` tolerates that by fuzzy-matching
 * token text instead of only comparing counts, so a single merge/split doesn't throw
 * away sentence boundaries for the WHOLE scene — only the previous code's exact
 * count check did that. Falls back to a fixed max-words-per-chunk grouping only when
 * alignment truly can't resync (chunking must never throw or misalign even then).
 */

/** Case/punctuation-insensitive comparison key — only letters/digits matter for
 *  matching a narration token against a spoken word_timestamps token. */
function normalizeToken(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

// How many neighboring tokens to try when a mismatch is found, in either direction,
// before giving up on resyncing at that point — covers the observed real-world
// pattern (a single word merged/split, not a whole phrase reordered) without risking
// a runaway search on stranger mismatches.
const RESYNC_LOOKAHEAD = 3;

/**
 * Walks `narrationWords` and `words` (word_timestamps) in lockstep, returning
 * `map` where `map[i]` is the index into `words` where narration word `i` STARTS —
 * tolerating the TTS engine merging 2+ narration words into one spoken token or
 * splitting 1 narration word into 2+. `map[i]` is `null` from the first
 * unresolvable desync onward (caller must treat that as "can't find sentence
 * boundaries past this point", not guess).
 */
function alignNarrationToWords(narrationWords, words) {
  const map = Array.from({ length: narrationWords.length }, () => null);
  let i = 0;
  let j = 0;
  while (i < narrationWords.length && j < words.length) {
    const nWord = normalizeToken(narrationWords[i]);
    const tWord = normalizeToken(words[j].word);
    if (nWord === tWord) {
      map[i] = j;
      i++;
      j++;
      continue;
    }

    // Merge: words[j] is narrationWords[i] + narrationWords[i+1] + ... spoken as one token.
    let merged = "";
    let mergeSpan = 0;
    for (let k = 0; k < RESYNC_LOOKAHEAD && i + k < narrationWords.length; k++) {
      merged += normalizeToken(narrationWords[i + k]);
      if (merged === tWord) {
        mergeSpan = k + 1;
        break;
      }
    }
    if (mergeSpan) {
      for (let m = 0; m < mergeSpan; m++) map[i + m] = j; // all merged narration words start at the same TTS token
      i += mergeSpan;
      j += 1;
      continue;
    }

    // Split: narrationWords[i] was spoken as words[j] + words[j+1] + ...
    let split = "";
    let splitSpan = 0;
    for (let k = 0; k < RESYNC_LOOKAHEAD && j + k < words.length; k++) {
      split += normalizeToken(words[j + k].word);
      if (split === nWord) {
        splitSpan = k + 1;
        break;
      }
    }
    if (splitSpan) {
      map[i] = j;
      i += 1;
      j += splitSpan;
      continue;
    }

    // Can't resync locally — stop; remaining entries stay null.
    break;
  }
  return map;
}

/**
 * Resolves each sentence's word-count boundary (counted over `narrationWords`) to
 * the matching index into `words`, via `alignNarrationToWords`. Returns `null`
 * (caller falls back to fixed-size chunking) if alignment didn't cleanly reach the
 * end — a partial/unreliable set of boundaries is worse than none, since a chunk
 * boundary landing on the wrong word is more confusing than no sentence-aware
 * splitting at all.
 */
function sentenceBoundariesInWords(narrationWords, words, sentenceWordCounts) {
  const map = alignNarrationToWords(narrationWords, words);
  const boundaries = [];
  let narrIdx = 0;
  for (const count of sentenceWordCounts) {
    narrIdx += count;
    const ttsIdx = narrIdx >= narrationWords.length ? words.length : map[narrIdx];
    if (ttsIdx === null || ttsIdx === undefined) return null;
    boundaries.push(ttsIdx);
  }
  return boundaries.at(-1) === words.length ? boundaries : null;
}

export function chunkWords(words, narration, { maxWordsPerChunk = 6 } = {}) {
  if (!words?.length) return [];

  const sentences = (narration ?? "")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sentenceWordCounts = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const narrationWords = sentences.flatMap((s) => s.split(/\s+/).filter(Boolean));

  const rawChunks = [];
  if (sentenceWordCounts.length > 1) {
    const ttsBoundaries = sentenceBoundariesInWords(narrationWords, words, sentenceWordCounts);
    if (ttsBoundaries) {
      let i = 0;
      for (const boundary of ttsBoundaries) {
        if (boundary > i) rawChunks.push(words.slice(i, boundary));
        i = boundary;
      }
    }
  }
  if (!rawChunks.length) rawChunks.push(words);

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
