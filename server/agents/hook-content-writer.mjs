/**
 * "Đọc Caption" tab's only content-generation step — replaces content-planner.mjs
 * entirely for this format (see plan.md): given 1 approved idea (from the SAME
 * idea-generator.mjs used by Batch.jsx) + a niche description, writes a single
 * structured `hook-plan.json` — no narration, no scenes, nothing for a voice to read.
 *
 * `caption.md` (the file the whole point of this format drives users toward) is built
 * DETERMINISTICALLY by code from `hook-plan.json`'s own fields right after the agent
 * call, not written by the model as a second free-text output — the 2 representations
 * (list items in JSON vs. in a separately-worded caption) could otherwise drift apart,
 * the same class of bug already hit elsewhere in this pipeline (root-composer.mjs's
 * enforceVoiceoverTags/enforceSceneTiming exist for exactly this reason). One
 * source of truth, formatted once.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { runAgent, CHEAP_MODEL } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";

/**
 * @param {object} params
 * @param {string} params.projectDir
 * @param {string} params.idea - the approved idea sentence from idea-generator.mjs,
 *   e.g. "Đàn ông ra ngoài kiếm tiền vất vả, về nhà chỉ cần vợ hiểu 3 điều này".
 * @param {string} params.nicheDescription - hook-profile's own niche description,
 *   gives the model tone/context (NOT DESIGN.md — that's a "motion"-only CSS/GSAP
 *   palette spec unrelated to this format, same lesson just applied in
 *   video-planner.mjs for template "sub").
 * @param {string} [params.ctaText] - hook-profile's configured CTA, default below.
 */
export async function runHookContentWriter({
  projectDir,
  idea,
  nicheDescription,
  ctaText = "ĐỌC CAPTION",
  model = CHEAP_MODEL,
  maxTurns = 4,
  onEvent,
  signal,
}) {
  const tools = createFsTools(projectDir);

  const systemPrompt = `Bạn là chuyên gia viết hook card cho Reels/TikTok dạng "Top N" —
video KHÔNG có giọng đọc, chỉ có 1 headline hook + 1 dòng "Top N" trên nền video mờ,
mục đích kích thích người xem bấm đọc phần caption (nơi chứa danh sách đầy đủ).

Nhiệm vụ: dựa vào 1 ý tưởng đã duyệt cho sẵn trong user message, viết ĐÚNG 1 file
\`hook-plan.json\` với các field:
- "hook": headline ngắn (1 câu hỏi hoặc câu khẳng định, chữ HOA hoặc câu thường đều
  được, tối đa ~8 từ) — vd "CHỒNG KHÔNG BAO GIỜ KHEN VỢ?"
- "highlightWord": ĐÚNG 1 từ hoặc cụm từ NGUYÊN VĂN xuất hiện y hệt bên trong "hook"
  (copy chính xác, kể cả hoa/thường) — từ này sẽ được tô màu nổi bật, chọn từ mang ý
  nghĩa cảm xúc mạnh nhất trong câu (vd "KHEN", "THỜI GIAN", "CẢM XÚC").
- "count": số nguyên (3-9) — số lượng điều/cách/bí quyết.
- "topic": cụm ngắn mô tả danh sách (vd "bí quyết đơn giản", "cách nhỏ dễ làm ngay",
  "điều mình đã thay đổi") — ghép với "count" sẽ đọc thành "Mình chỉ thay đổi {count}
  {topic}".
- "listItems": mảng ĐÚNG "count" phần tử, mỗi phần tử là 1 câu ngắn (không cần đánh số,
  code sẽ tự đánh số) mô tả 1 điều/cách cụ thể, hữu ích thật — đây là nội dung CHÍNH sẽ
  nằm trong caption, phải đủ giá trị để người đọc thấy đáng bấm "${ctaText}".
- "hashtags": mảng 8-12 hashtag (không có dấu #, code sẽ tự thêm) phù hợp niche cho
  sẵn, trộn tag hẹp (đúng chủ đề) lẫn tag rộng (dễ tiếp cận).

BẮT BUỘC:
- "highlightWord" PHẢI là substring xuất hiện NGUYÊN VĂN, chính xác từng ký tự (kể cả
  hoa/thường) bên trong "hook" — nếu không tìm thấy chính xác, hệ thống sẽ không tô
  màu được gì cả.
- Giọng văn khớp niche mô tả trong user message — không lạc đề.
- KHÔNG thêm field nào khác ngoài 6 field trên.

Bạn đang chạy tự động (non-interactive) — KHÔNG được hỏi lại vì không ai trả lời. Dùng
tool \`write_file\` để lưu đúng 1 file vào project root (path tương đối, không tiền
tố): \`hook-plan.json\`. Sau khi ghi xong, trả lời bằng 1 câu tóm tắt ngắn — không tool
call nào nữa.`;

  const userPrompt = [`Ý tưởng đã duyệt: ${idea}`, `Niche/đối tượng: ${nicheDescription}`].join("\n");

  const result = await runAgent({ systemPrompt, userPrompt, tools, model, maxTurns, onEvent, stopAfterWrites: 1, signal });

  const planFile = join(projectDir, "hook-plan.json");
  if (!existsSync(planFile)) return result;

  const plan = JSON.parse(readFileSync(planFile, "utf-8"));

  // Same "code writes the derived/structural output, don't gamble on the model"
  // pattern as root-composer.mjs — highlightWord not matching verbatim is a real,
  // expected possibility (any LLM can slip on an exact-substring instruction), so
  // fail soft here (no highlight) rather than have hook-style.mjs's render() guess.
  if (typeof plan.hook === "string" && typeof plan.highlightWord === "string" && !plan.hook.includes(plan.highlightWord)) {
    onEvent?.({ type: "hook-highlight-mismatch", hook: plan.hook, highlightWord: plan.highlightWord });
  }

  const listBlock = (plan.listItems ?? []).map((item, i) => `${i + 1}. ${item}`).join("\n");
  const hashtagBlock = (plan.hashtags ?? []).map((h) => `#${String(h).replace(/^#/, "")}`).join(" ");
  const caption = [plan.hook, "", listBlock, "", ctaText, "", hashtagBlock].filter((line) => line !== undefined).join("\n");
  writeFileSync(join(projectDir, "caption.md"), caption);
  onEvent?.({ type: "write", outPath: "caption.md" });

  return result;
}
