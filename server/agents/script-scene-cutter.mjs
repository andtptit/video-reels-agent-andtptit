/**
 * "Dán kịch bản có sẵn" — user pastes an already-written script (their own wording,
 * no AI rewriting allowed), the model ONLY chooses scene boundaries by MEANING —
 * same "cắt cảnh theo ý nghĩa, không viết lại chữ" job as audio-scene-cutter.mjs
 * does for a real transcript, but there's no audio yet here (this feeds straight
 * into generate-audio.mjs's TTS step afterward, same as content-planner.mjs's own
 * output). Narration text is RECONSTRUCTED IN CODE from the model's word_start/
 * word_end indices — never trusted from the model's own retyped text — so there is
 * zero risk of the LLM silently paraphrasing a carefully-written line; the model's
 * only creative input is where to cut, not what the words say.
 *
 * master_content.md is built BY JOINING the final scene narrations (not the user's
 * raw pasted formatting) — same approach audio-import.mjs uses for the same
 * "narration must be a verbatim substring of master_content.md" invariant
 * (caption-chunks.mjs's alignment convention) to hold by construction.
 */
import { writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { runAgent, DEFAULT_MODEL } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";

const OUT_FILE = "script-cuts.json";
const MAX_ATTEMPTS = 2;

// Typical spoken Vietnamese narration pace for short-form video (matches edge-tts's
// own 1.1x-rate default elsewhere in this codebase) — estimated_duration is only
// ever a planning aid (real timing comes from the actual TTS call later, see
// scene-timing-assembler.mjs), so this doesn't need to be precise.
const WORDS_PER_SEC = 2.5;

/** Splits the pasted script into words, tracking which word indices sit at the END
 *  of a blank-line-separated paragraph — the strongest "the writer meant a beat/
 *  pause here" signal available for text with no real audio to measure gaps from. */
function tokenizeScript(scriptText) {
  const paragraphs = scriptText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const words = [];
  const paragraphEndIndices = new Set();
  for (const para of paragraphs) {
    for (const w of para.split(/\s+/).filter(Boolean)) words.push(w);
    if (words.length) paragraphEndIndices.add(words.length - 1);
  }
  return { words, paragraphEndIndices };
}

function buildIndexedScript(words, paragraphEndIndices) {
  return words.map((w, i) => `${i}:${w}${paragraphEndIndices.has(i) ? "|" : ""}`).join(" ");
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
  if (prevEnd < wordCount * 0.9) {
    return { ok: false, error: `Các scene chỉ phủ tới từ #${prevEnd}/${wordCount} — thiếu quá nhiều nội dung, phải cắt hết (gần) toàn bộ kịch bản, không được bỏ qua cả đoạn.` };
  }
  return { ok: true };
}

/**
 * @param {object} params
 * @param {string} params.projectDir
 * @param {string} params.scriptText - the user's own, already-written script — never
 *   rewritten, only cut into scenes
 * @param {string} [params.targetDuration] - reference only, real duration = word count
 * @param {string} [params.platform] - "9:16" | "16:9", written into scenes.json
 * @param {string} [params.model]
 * @param {(event: object) => void} [params.onEvent]
 * @param {AbortSignal} [params.signal]
 */
export async function runScriptSceneCutter({
  projectDir,
  scriptText,
  targetDuration = "30–60s",
  platform = "9:16",
  model = DEFAULT_MODEL,
  onEvent = () => {},
  signal,
}) {
  const tools = createFsTools(projectDir);
  const { words, paragraphEndIndices } = tokenizeScript(scriptText);
  if (!words.length) throw new Error("Kịch bản rỗng — không có từ nào để cắt cảnh.");
  const wordCount = words.length;
  const indexed = buildIndexedScript(words, paragraphEndIndices);

  const systemPrompt = `Bạn là chuyên gia dựng video ngắn (TikTok/Reels/Shorts) tiếng Việt.
Nhiệm vụ: cắt 1 KỊCH BẢN NGƯỜI DÙNG ĐÃ VIẾT SẴN thành các "scene" theo Ý NGHĨA — mỗi
scene là 1 ý trọn vẹn, 1 nhịp cảm xúc, độ dài lý tưởng 5-10s (tối thiểu 4s, tối đa
15s — gộp phần ngắn hơn 4s vào scene liền kề).

QUY TẮC CẮT:
- Cắt khi: chuyển ý, chuyển nhịp/cảm xúc, kết thúc 1 ý trọn vẹn, hoặc có dòng trống
  trong bản gốc (dấu "|" ngay sau 1 từ nghĩa là sau từ đó tác giả để 1 dòng trống —
  tín hiệu "đây là 1 nhịp riêng" rất mạnh, ưu tiên cắt ở đây khi hợp lý).
- TUYỆT ĐỐI KHÔNG được viết lại, paraphrase, thêm, bớt hay sửa BẤT KỲ từ nào — đây là
  chữ của người dùng, không phải của bạn. Việc DUY NHẤT bạn làm là chọn RANH GIỚI cắt.

KỊCH BẢN (đã đánh số từ, "|" = có dòng trống ngay sau từ đó trong bản gốc):
${indexed}

Với MỖI scene, xác định:
- word_start, word_end: chỉ số từ BẮT ĐẦU (inclusive) và KẾT THÚC (exclusive) — ví dụ
  scene gồm từ #0 tới #14 thì word_start=0, word_end=15.
- meaning: 1 câu — LÝ DO scene này tồn tại trong mạch nội dung.
- mood_hint: 1 trong "explosive" | "cinematic" | "snappy" | "technical" | "fluid".
- is_hook: true cho scene ĐẦU TIÊN (mở đầu gây chú ý), false cho các scene còn lại.
- sceneId: "scene_01", "scene_02", ... theo đúng thứ tự.

word_start/word_end của các scene PHẢI theo đúng thứ tự, không chồng lấn, và phải phủ
gần hết kịch bản (được phép bỏ qua vài từ đệm ở đầu/cuối, KHÔNG được bỏ qua cả đoạn
nội dung thật). KHÔNG trả về trường "narration" — code sẽ tự trích nguyên văn theo
word_start/word_end, không dùng bản bạn gõ lại.

Tổng thời lượng mong muốn cho cả video: ${targetDuration} (chỉ để tham khảo, ưu tiên
đúng ranh giới ý nghĩa hơn khớp đúng con số này).

Bạn đang chạy tự động (non-interactive) — KHÔNG hỏi lại. Dùng tool \`write_file\` để
lưu ĐÚNG 1 file "${OUT_FILE}" ở project root, nội dung JSON dạng:
{"scenes": [{"sceneId": "scene_01", "word_start": 0, "word_end": 15, "meaning": "...", "mood_hint": "...", "is_hook": true}, ...]}
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

  let cuts;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const userPrompt = attempt === 0 ? "Cắt kịch bản trên thành các scene theo đúng quy tắc." : `Lần cắt trước bị lỗi: ${lastError}\n\nSửa lại và ghi lại đúng "${OUT_FILE}".`;

    let result;
    try {
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
    cuts = parsed.scenes;
    break;
  }

  if (!cuts) {
    const err = new Error(`Agent cắt cảnh kịch bản thất bại sau ${MAX_ATTEMPTS} lần thử: ${lastError}`);
    err.usage = usage;
    throw err;
  }

  const scenes = cuts.map((c) => {
    const narration = words.slice(c.word_start, c.word_end).join(" ");
    return {
      sceneId: c.sceneId,
      narration,
      meaning: c.meaning,
      estimated_duration: Math.max(1, Math.round((c.word_end - c.word_start) / WORDS_PER_SEC)),
      mood_hint: c.mood_hint,
      is_hook: Boolean(c.is_hook),
    };
  });

  const masterContent = scenes.map((s) => s.narration).join("\n\n");
  writeFileSync(join(projectDir, "master_content.md"), masterContent);

  const scenesJson = {
    master_content: "master_content.md",
    platform,
    total_estimated_duration: scenes.reduce((sum, s) => sum + s.estimated_duration, 0),
    scenes,
  };
  writeFileSync(join(projectDir, "scenes.json"), JSON.stringify(scenesJson, null, 2));
  onEvent({ type: "scene-cut-done", sceneCount: scenes.length });

  return { ok: true, sceneCount: scenes.length, usage };
}
