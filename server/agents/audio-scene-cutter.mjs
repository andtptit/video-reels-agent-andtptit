/**
 * "Cắt cảnh theo ý nghĩa" applied to an EXISTING transcript instead of freshly-written
 * narration (content-planner.mjs's job) — see the "tạo từ audio có sẵn" feature in
 * audio-import.mjs. Reuses run-agent.mjs + fs-tools.mjs, same harness content-
 * planner.mjs uses, but the model returns WORD-INDEX boundaries into the real
 * transcript rather than copying narration text: making the model reproduce long
 * verbatim Vietnamese spans just so code could fuzzy-match them back against
 * word_timestamps (caption-chunks.mjs's job) would be re-introducing the exact
 * TTS-token-mismatch fuzziness that function exists to tolerate, not something worth
 * inviting deliberately when the source text is already known exactly. The model DOES
 * write a `narration` string per scene (with proper punctuation) — that's for
 * captions/master_content.md only; the word_start/word_end indices are always
 * authoritative for the actual audio cut points.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { runAgent, DEFAULT_MODEL } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";

const OUT_FILE = "scene-cuts.json";
const MAX_ATTEMPTS = 2; // 1 initial + 1 retry with the specific validation error fed back

// >0.4s gap between 2 words is a much stronger "natural pause" signal than
// content-planner ever has access to (it only has text, never real audio) — cheap to
// compute, surfaced directly in the prompt via a "|" marker right after the word.
const PAUSE_GAP_SEC = 0.4;

function buildIndexedTranscript(words) {
  return words
    .map((w, i) => {
      const pause = i < words.length - 1 && words[i + 1].start - w.end > PAUSE_GAP_SEC ? "|" : "";
      return `${i}:${w.word}${pause}`;
    })
    .join(" ");
}

function validateCuts(cuts, wordCount) {
  if (!Array.isArray(cuts) || !cuts.length) return { ok: false, error: "scenes rỗng hoặc không phải mảng." };
  let prevEnd = -1;
  for (const [i, c] of cuts.entries()) {
    if (!c.sceneId || typeof c.word_start !== "number" || typeof c.word_end !== "number") {
      return { ok: false, error: `Scene #${i + 1} thiếu sceneId/word_start/word_end.` };
    }
    if (c.word_start < 0 || c.word_end > wordCount || c.word_start >= c.word_end) {
      return { ok: false, error: `Scene "${c.sceneId}": word_start/word_end không hợp lệ (khoảng hợp lệ 0-${wordCount}, phải word_start < word_end).` };
    }
    if (c.word_start < prevEnd) {
      return { ok: false, error: `Scene "${c.sceneId}": word_start (${c.word_start}) chồng lấn với scene trước (kết thúc ở từ #${prevEnd}).` };
    }
    prevEnd = c.word_end;
  }
  // Allow skipping a few filler/padding words at the edges, but the cuts must cover
  // the bulk of the transcript — stopping halfway means real speech got lost.
  if (prevEnd < wordCount * 0.9) {
    return { ok: false, error: `Các scene chỉ phủ tới từ #${prevEnd}/${wordCount} — thiếu quá nhiều nội dung, phải cắt hết (gần) toàn bộ transcript, không được bỏ qua cả đoạn.` };
  }
  return { ok: true };
}

/**
 * @param {{projectDir: string, words: {word: string, start: number, end: number}[],
 *   targetDuration?: string, model?: string, onEvent?: Function, signal?: AbortSignal}} params
 * @returns {Promise<{scenes: object[], usage: object}>}
 */
export async function runAudioSceneCutter({ projectDir, words, targetDuration = "30–60s", model = DEFAULT_MODEL, onEvent = () => {}, signal }) {
  const tools = createFsTools(projectDir);
  const indexed = buildIndexedTranscript(words);
  const wordCount = words.length;

  const systemPrompt = `Bạn là chuyên gia dựng video ngắn (TikTok/Reels/Shorts) tiếng Việt.
Nhiệm vụ: cắt 1 đoạn TRANSCRIPT CÓ SẴN (đã có timestamp thật cho từng từ) thành các
"scene" theo Ý NGHĨA — mỗi scene là 1 ý trọn vẹn, 1 cảm xúc, độ dài lý tưởng 5-10s
(tối thiểu 4s, tối đa 15s — gộp phần ngắn hơn 4s vào scene liền kề).

QUY TẮC CẮT:
- Cắt khi: chuyển chủ đề, chuyển cảm xúc, kết thúc 1 ý trọn vẹn, có khoảng lặng tự
  nhiên (dấu "|" ngay sau 1 từ nghĩa là sau từ đó có khoảng lặng >0.4s trong audio
  thật — tín hiệu ngừng tự nhiên mạnh, ưu tiên cắt ở đây khi hợp lý).
- KHÔNG cắt giữa 1 ý, hoặc khi câu sau phụ thuộc trực tiếp câu trước.
- KHÔNG được bịa/sửa nội dung — chỉ được chọn RANH GIỚI cắt trong transcript có sẵn.

TRANSCRIPT (đã đánh số từ, "|" = khoảng lặng dài ngay sau từ đó):
${indexed}

Với MỖI scene, xác định:
- word_start, word_end: chỉ số từ BẮT ĐẦU (inclusive) và KẾT THÚC (exclusive) trong
  transcript trên — ví dụ scene gồm từ #0 tới #14 thì word_start=0, word_end=15.
- narration: chép lại ĐÚNG các từ #word_start..word_end-1 theo thứ tự, thêm dấu câu
  phù hợp (., !, ?, dấu phẩy) cho dễ đọc — KHÔNG thêm/bớt/đổi từ nào so với transcript.
- meaning: 1 câu — LÝ DO scene này tồn tại trong mạch nội dung.
- mood_hint: 1 trong "explosive" | "cinematic" | "snappy" | "technical" | "fluid".
- is_hook: true cho scene ĐẦU TIÊN (mở đầu gây chú ý), false cho các scene còn lại.
- sceneId: "scene_01", "scene_02", ... theo đúng thứ tự.

word_start/word_end của các scene PHẢI theo đúng thứ tự, không chồng lấn, và phải phủ
gần hết transcript (được phép bỏ qua vài từ đệm/ậm ừ ở đầu/cuối, KHÔNG được bỏ qua cả
đoạn nội dung thật).

Tổng thời lượng mong muốn cho cả video: ${targetDuration} (chỉ để tham khảo, ưu tiên
đúng ranh giới ý nghĩa hơn khớp đúng con số này).

Bạn đang chạy tự động (non-interactive) — KHÔNG hỏi lại. Dùng tool \`write_file\` để
lưu ĐÚNG 1 file "${OUT_FILE}" ở project root, nội dung JSON dạng:
{"scenes": [{"sceneId": "scene_01", "word_start": 0, "word_end": 15, "narration": "...", "meaning": "...", "mood_hint": "...", "is_hook": true}, ...]}
Sau khi ghi file xong, trả lời bằng 1 câu tóm tắt ngắn — không tool call nào nữa.`;

  let priorMessages = null;
  let lastError = null;
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 };
  const addUsage = (u) => {
    if (!u) return;
    usage.promptTokens += u.promptTokens ?? 0;
    usage.completionTokens += u.completionTokens ?? 0;
    usage.totalTokens += u.totalTokens ?? 0;
    usage.apiCalls += u.apiCalls ?? 0;
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const userPrompt =
      attempt === 0
        ? "Cắt transcript trên thành các scene theo đúng quy tắc."
        : `Lần cắt trước bị lỗi: ${lastError}\n\nSửa lại và ghi lại đúng "${OUT_FILE}".`;

    let result;
    try {
      // stopAfterWrites: 1 — this task only ever writes 1 file, same reasoning as
      // scene-writer.mjs's own use of this flag (see run-agent.mjs's doc comment).
      result = await runAgent({ systemPrompt, userPrompt, tools, model, priorMessages, stopAfterWrites: 1, onEvent, signal });
    } catch (err) {
      addUsage(err.usage);
      err.usage = { ...usage };
      throw err;
    }
    priorMessages = result.messages;
    addUsage(result.usage);

    const outPath = join(projectDir, OUT_FILE);
    if (!existsSync(outPath)) {
      lastError = `Không tìm thấy file "${OUT_FILE}" — model không gọi write_file.`;
      onEvent({ type: "scene-cut-retry", attempt: attempt + 1, error: lastError });
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(outPath, "utf-8"));
    } catch (err) {
      lastError = `"${OUT_FILE}" không phải JSON hợp lệ: ${err.message}`;
      onEvent({ type: "scene-cut-retry", attempt: attempt + 1, error: lastError });
      continue;
    }
    const check = validateCuts(parsed.scenes, wordCount);
    if (!check.ok) {
      lastError = check.error;
      onEvent({ type: "scene-cut-retry", attempt: attempt + 1, error: check.error });
      continue;
    }
    onEvent({ type: "scene-cut-done", sceneCount: parsed.scenes.length });
    return { scenes: parsed.scenes, usage };
  }

  const err = new Error(`Agent cắt cảnh từ transcript thất bại sau ${MAX_ATTEMPTS} lần thử: ${lastError}`);
  err.usage = usage;
  throw err;
}
