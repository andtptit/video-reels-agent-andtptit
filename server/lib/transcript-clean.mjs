/**
 * Cleaning/quality-check rules for raw transcription output — ported from this repo's
 * own .agents/skills/hyperframes/references/transcript-guide.md, which until now only
 * had these as prose/example code for an interactive agent to eyeball by hand
 * ("read the transcript and check for quality issues before proceeding"). audio-
 * import.mjs runs fully unattended, so the same rules need to be real code here.
 * Operates on this project's `{word, start, end}` shape (see word_timestamps
 * convention in generate-audio.mjs) — the transcription provider renames the CLI's
 * own `text` field to `word` before this ever sees it.
 */

const MUSIC_TOKEN_RE = /^[♪�♪♫♬♭♮♯]+$/;
const SHORT_FILLER_RE = /^(huh|uh|um|ah|oh)$/i;

/** Strips music-note tokens and very short filler words (guide's own thresholds). */
export function cleanTranscriptWords(words) {
  return (words ?? []).filter((w) => {
    if (!w.word || !w.word.trim()) return false;
    if (MUSIC_TOKEN_RE.test(w.word)) return false;
    if (SHORT_FILLER_RE.test(w.word) && w.end - w.start < 0.1) return false;
    return true;
  });
}

/**
 * >20% music/garbage tokens = transcription failed (guide's own threshold) — surfaced
 * as `{ok:false}` so a genuinely bad transcription (noisy/music-heavy audio) errors
 * out loudly here instead of feeding garbage into the scene-cutter LLM downstream.
 */
export function checkTranscriptQuality(words) {
  if (!words?.length) return { ok: false, error: "Transcript rỗng — không nhận diện được từ nào trong audio." };
  const garbageCount = words.filter((w) => !w.word?.trim() || MUSIC_TOKEN_RE.test(w.word)).length;
  const garbageRatio = garbageCount / words.length;
  if (garbageRatio > 0.2) {
    return {
      ok: false,
      error: `Transcript có ${Math.round(garbageRatio * 100)}% token rác (nhạc/nhiễu) — audio có thể có nhạc nền hoặc quá nhiễu để phiên âm chính xác bằng model hiện tại. Thử lại với whisper model lớn hơn (medium/large-v3), hoặc dùng audio sạch hơn (không nhạc nền).`,
      garbageRatio,
    };
  }
  return { ok: true, garbageRatio };
}
