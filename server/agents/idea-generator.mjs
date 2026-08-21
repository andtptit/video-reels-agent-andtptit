/**
 * Batch idea-generation agent — for the "Hàng loạt" tab (Batch.jsx). Given a fixed
 * channel theme + audience, generates N distinct video ideas in one call, each
 * phraseable directly as the single-video flow's own `idea` input (so the caller can
 * feed it straight into `createProject()`/`runContentPlanner()` unchanged once
 * approved). No `.agents/skills/idea-generator/SKILL.md` — unlike content-planner.mjs/
 * video-planner.mjs (which wrap a real interactive Claude Code skill), this task has
 * no manual-workflow equivalent to reuse, so the prompt is inlined here, same as
 * remix-scenes.mjs.
 *
 * Deliberately NOT web-search/trend-sourced (confirmed with user) — diversity comes
 * entirely from an explicit rotation framework in the prompt (hook style, tone,
 * sub-topic spread) plus an avoid-list of sub-topics already turned into real videos
 * for this channel (see lib/idea-history.mjs) — ported from a sibling repo
 * (hqbt-content-creation's content-ideation skill) that uses the same "explicit
 * rotation rules + read recent history" approach instead of embeddings/vector search.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { runAgent, DEFAULT_MODEL } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";

const HOOK_STYLES = ["so-lieu", "trai-chieu", "ke-chuyen", "cau-hoi", "thu-nhan", "tuyen-bo"];
const TONES = ["day-kien-thuc", "de-ton-thuong", "bold-provocative", "thuc-hanh-tung-buoc"];

/**
 * @param {object} params
 * @param {string} params.batchDir - scratch working dir (server/batches/{id}/, see
 *   lib/batch-id.mjs) — NOT a real video project dir, just holds ideas.json.
 * @param {string} params.channelTheme
 * @param {string} params.audience
 * @param {number} [params.count]
 * @param {string[]} [params.avoidList] - "subTopic — idea text" strings from
 *   lib/idea-history.mjs's readIdeaHistory(), already turned into real videos.
 * @param {string} [params.contentPlaybook] - profile's free-text creative direction
 *   (persona/nhân vật, giọng kể, điều nên/không nên) — see lib/profiles.mjs's
 *   `contentPlaybook` field. Layered ON TOP of the fixed hookStyle/tone rotation
 *   below, never replacing it — diversity rules stay mechanical/enforceable, while
 *   this free text shapes WHAT the ideas are actually about.
 * @param {string[]} [params.tones] - overrides the default TONES list — see
 *   lib/profiles.mjs's `ideaTones` field. A channel whose content genre can't
 *   naturally support all 4 default tones (found live: a pure-confession/love-letter
 *   channel forced into "day-kien-thuc"/"thuc-hanh-tung-buoc" produced ideas with a
 *   tag that plainly didn't fit the actual content) can narrow this to only the
 *   tones that genuinely fit.
 */
export async function runIdeaGenerator({
  batchDir,
  channelTheme,
  audience,
  count = 10,
  avoidList = [],
  contentPlaybook,
  tones = TONES,
  model = DEFAULT_MODEL,
  maxTurns = 6,
  onEvent,
  signal,
}) {
  const tools = createFsTools(batchDir);

  const systemPrompt = `Bạn là chuyên gia lên ý tưởng video ngắn (TikTok/Reels/Shorts)
cho một kênh cụ thể. Nhiệm vụ: sinh ĐÚNG ${count} ý tưởng video KHÁC NHAU dựa trên chủ
đề kênh và đối tượng xem cho sẵn trong user message — KHÔNG tìm kiếm hay dùng nguồn bên
ngoài nào, chỉ tự suy nghĩ dựa trên chủ đề kênh + khung đa dạng bên dưới.

Mỗi ý tưởng gồm ĐÚNG 4 field:
- "idea": 1 câu ý tưởng video CỤ THỂ có hook rõ ràng, viết y như gõ thẳng vào ô "ý
  tưởng" khi tạo 1 project mới — TỐT (cụ thể, có hook): "5 dấu hiệu bạn đang tự làm
  khổ mình mà không biết". KHÔNG TỐT (quá chung chung, không dùng được): "video về
  chữa lành cảm xúc".
- "hookStyle": ĐÚNG 1 trong 6 giá trị sau, không tự bịa giá trị khác: ${HOOK_STYLES.join(", ")}.
- "subTopic": cụm 2-5 từ tiếng Việt mô tả chủ đề con hẹp của ý tưởng đó (dùng để kiểm
  tra trùng lặp — phải đủ cụ thể để 2 ý tưởng thật sự khác nhau thì subTopic cũng khác
  nhau rõ).
- "tone": ĐÚNG 1 trong ${tones.length} giá trị sau, không tự bịa giá trị khác: ${tones.join(", ")}.

QUY TẮC ĐA DẠNG (BẮT BUỘC, không thỏa hiệp):
1. TUYỆT ĐỐI KHÔNG quá 2 ý tưởng cùng subTopic giống/gần giống nhau trong ${count} ý
   tưởng — phải phủ ít nhất ${Math.ceil(count / 2)} chủ đề con khác nhau.
2. TUYỆT ĐỐI KHÔNG để 2 ý tưởng LIÊN TIẾP (theo đúng thứ tự trong mảng "ideas" sẽ ghi
   ra) trùng "hookStyle".
3. Cả ${tones.length} giá trị "tone" phải xuất hiện ít nhất 1 lần trong ${count} ý
   tưởng (nếu ${count} nhỏ hơn ${tones.length}, ưu tiên đa dạng tone nhiều nhất có
   thể) — NHƯNG chỉ gán tone thật sự khớp nội dung ý tưởng đó; TUYỆT ĐỐI KHÔNG ép
   1 tone không hợp vào 1 ý tưởng chỉ để đủ đầu việc phủ tone.
4. TUYỆT ĐỐI KHÔNG trùng hoặc na ná bất kỳ mục nào trong danh sách "Chủ đề đã lên video
   thật — TRÁNH" ở user message bên dưới (nếu có).
5. "idea" và "subTopic" viết HOÀN TOÀN bằng tiếng Việt — không tự chèn từ/cụm tiếng Anh
   trừ khi chủ đề kênh bắt buộc phải giữ nguyên tên riêng.
6. Mỗi ý tưởng phải khớp đúng chủ đề kênh và đối tượng xem cho sẵn — không lạc đề.
7. ĐA DẠNG CẤU TRÚC CÂU THẬT SỰ, không chỉ đổi nhãn hookStyle: KHÔNG được quá 2 ý
   tưởng trong ${count} ý tưởng dùng chung 1 khung câu "[vế A] — [vế B]" nối bằng dấu
   gạch ngang. Đổi công thức câu theo đúng hookStyle của nó — "cau-hoi" phải là 1 câu
   hỏi thật (có dấu ?), "so-lieu" phải mở bằng số liệu/con số cụ thể, "tuyen-bo" là 1
   câu khẳng định dứt khoát không có vế giải thích đi kèm, "ke-chuyen" kể 1 tình
   huống có trình tự thời gian, "thu-nhan" là lời thú nhận trực tiếp ở ngôi thứ
   nhất — không phải cùng 1 khung "[hành động] — [diễn giải]" mặc thêm nhãn khác nhau.

Bạn đang chạy tự động (non-interactive) — KHÔNG được hỏi lại vì không ai trả lời. Dùng
tool \`write_file\` để lưu đúng 1 file vào thư mục làm việc (path tương đối, không tiền
tố): \`ideas.json\`, đúng format:
\`\`\`json
{ "ideas": [ { "idea": "...", "hookStyle": "...", "subTopic": "...", "tone": "..." } ] }
\`\`\`
Mảng "ideas" phải có ĐÚNG ${count} phần tử, theo ĐÚNG thứ tự sinh ra (thứ tự này dùng để
kiểm tra luật #2 ở trên). Sau khi ghi file xong, trả lời bằng 1 câu tóm tắt ngắn —
không tool call nào nữa.`;

  const avoidBlock = avoidList.length
    ? `Chủ đề đã lên video thật — TRÁNH:\n${avoidList.map((a) => `- ${a}`).join("\n")}`
    : "(Chưa có lịch sử ý tưởng nào trước đó cho kênh này.)";

  const playbookBlock = contentPlaybook?.trim()
    ? `Định hướng nội dung riêng của kênh này (BẮT BUỘC tuân theo, quan trọng hơn cách diễn giải chung chung ở trên):\n${contentPlaybook.trim()}`
    : null;

  const userPrompt = [
    `Chủ đề kênh: ${channelTheme}`,
    `Đối tượng xem: ${audience}`,
    `Số lượng ý tưởng cần: ${count}`,
    "",
    ...(playbookBlock ? [playbookBlock, ""] : []),
    avoidBlock,
  ].join("\n");

  const result = await runAgent({ systemPrompt, userPrompt, tools, model, maxTurns, onEvent, signal });

  const outFile = join(batchDir, "ideas.json");
  if (!existsSync(outFile)) return result;

  const written = JSON.parse(readFileSync(outFile, "utf-8"));
  const rawIdeas = written.ideas ?? [];

  // Code-owned fields, not trusted to the model — same lesson applied throughout this
  // pipeline (video-planner.mjs's `template`/`subStyle`): the LLM proposes content,
  // the caller assigns structural bookkeeping fields.
  const ideas = rawIdeas.map((idea, i) => ({
    ideaId: `idea-${String(i + 1).padStart(2, "0")}`,
    idea: idea.idea,
    hookStyle: idea.hookStyle,
    subTopic: idea.subTopic,
    tone: idea.tone,
    kept: true,
    status: "pending",
    projectId: null,
    platform: null,
    error: null,
  }));

  // Soft checks only (warn via onEvent, never throw) — same "LLMs can slip on an
  // exact-count/no-repeat instruction even when told explicitly" reasoning as
  // checkDurationSum in tools/validators.mjs. A count mismatch or one repeated
  // hookStyle pair isn't worth failing the whole batch over; the user reviews every
  // idea before anything gets created anyway.
  if (ideas.length !== count) {
    onEvent?.({ type: "diversity-check", issue: "count-mismatch", expected: count, actual: ideas.length });
  }
  for (let i = 1; i < ideas.length; i++) {
    if (ideas[i].hookStyle && ideas[i].hookStyle === ideas[i - 1].hookStyle) {
      onEvent?.({ type: "diversity-check", issue: "consecutive-hook-style", index: i, hookStyle: ideas[i].hookStyle });
    }
  }

  // Hard duplicate check — confirmed live: the LLM was told an idea's subTopic was in
  // the "TRÁNH" avoid-list and generated the EXACT same idea text again anyway (word
  // for word, a day apart), and it got approved into a real project before anyone
  // noticed. The "TRÁNH" instruction alone isn't reliable enough on its own — this
  // catches an exact/near-exact repeat mechanically instead of trusting compliance.
  // Still a soft warning only (same philosophy as the checks above): a false positive
  // here (two genuinely different ideas that just normalize to the same string) isn't
  // worth blocking the batch over, the user reviews every idea before anything real
  // gets created anyway.
  const normalize = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const avoidIdeaTexts = avoidList.map((a) => {
    const sep = a.indexOf(" — ");
    return normalize(sep >= 0 ? a.slice(sep + 3) : a);
  });
  const seenInBatch = new Map();
  for (const idea of ideas) {
    const norm = normalize(idea.idea);
    if (!norm) continue;
    if (avoidIdeaTexts.includes(norm)) {
      onEvent?.({ type: "diversity-check", issue: "duplicate-of-history", ideaId: idea.ideaId, idea: idea.idea });
    } else if (seenInBatch.has(norm)) {
      onEvent?.({ type: "diversity-check", issue: "duplicate-within-batch", ideaId: idea.ideaId, duplicateOf: seenInBatch.get(norm), idea: idea.idea });
    }
    seenInBatch.set(norm, idea.ideaId);
  }

  const envelope = {
    channelTheme,
    audience,
    requestedCount: count,
    avoidListUsed: avoidList,
    createdAt: new Date().toISOString(),
    ideas,
  };
  writeFileSync(outFile, JSON.stringify(envelope, null, 2));

  return { ...result, ideas };
}
