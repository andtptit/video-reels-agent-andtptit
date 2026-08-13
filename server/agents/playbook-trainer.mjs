/**
 * "Training" cho Content playbook (ProfileManager.jsx) — user mô tả ý muốn + gửi 1
 * hoặc nhiều kịch bản mẫu họ ưng ý (paste text, hoặc transcript tự động từ video đối
 * thủ — xem routes.mjs's /train-playbook-videos), agent này TRÍCH XUẤT pattern trừu
 * tượng (giọng xưng hô, nhịp câu, thủ pháp tu từ, điều nên/không nên) rồi viết lại
 * thành Content playbook mới — KHÔNG chép nguyên văn kịch bản mẫu vào playbook. Lý do:
 * content-planner.mjs nhét playbook y nguyên vào prompt của MỌI video sau này (xem doc
 * comment của nó) — nếu playbook chứa nguyên văn kịch bản mẫu, các video sau dễ nhại
 * lại đúng cụm từ cũ, nghe lặp. Trích ra quy tắc trừu tượng thay vì giữ ví dụ cụ thể
 * cho kết quả đa dạng hơn về lâu dài trong khi vẫn giữ đúng tinh thần giọng văn.
 *
 * Với NHIỀU mẫu (3-5 video đối thủ): model được yêu cầu tìm pattern LẶP LẠI xuyên suốt
 * các mẫu, không mô tả riêng từng cái — pattern chỉ xuất hiện ở 1/5 mẫu nhiều khả năng
 * là ngẫu nhiên, không phải "công thức thật" của kênh đó.
 *
 * CỘNG DỒN, không ghi đè: nếu đã có playbook cũ, model được yêu cầu GIỮ những gì còn
 * đúng, chỉ bổ sung/tinh chỉnh theo mẫu mới — vì user có thể train nhiều lần theo thời
 * gian, mỗi lần một khía cạnh khác của giọng văn.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { runAgent, DEFAULT_MODEL } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";

const OUT_FILE = "playbook.json";

/**
 * @param {object} params
 * @param {string} params.batchDir - scratch dir (lib/batch-id.mjs's createBatchDir())
 * @param {string} params.description - user's free-text description of what they want
 * @param {string[]} params.sampleScripts - 1 hoặc nhiều kịch bản mẫu user ưng ý
 * @param {string} [params.existingPlaybook] - playbook hiện tại của profile, nếu có
 * @param {string} [params.model]
 * @param {(event: object) => void} [params.onEvent]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{playbook: string, usage: object}>}
 */
export async function runPlaybookTrainer({ batchDir, description, sampleScripts, existingPlaybook, model = DEFAULT_MODEL, onEvent = () => {}, signal }) {
  const tools = createFsTools(batchDir);
  const samples = (sampleScripts ?? []).filter((s) => s?.trim());
  if (!samples.length) throw new Error("Cần ít nhất 1 kịch bản mẫu.");
  const multiSample = samples.length > 1;

  const systemPrompt = `Bạn là chuyên gia phân tích giọng văn (voice/style) cho kênh video
ngắn tiếng Việt. Nhiệm vụ: đọc ${samples.length} kịch bản mẫu user ưng ý + mô tả ý muốn
của họ, TRÍCH XUẤT các quy tắc/pattern trừu tượng về giọng văn — rồi viết thành 1 đoạn
"Content playbook" ngắn gọn, súc tích, dạng chỉ dẫn bắt buộc (không phải bài phân tích).

QUAN TRỌNG:
- TUYỆT ĐỐI KHÔNG chép nguyên câu/cụm từ cụ thể từ kịch bản mẫu vào playbook — playbook
  này sẽ được dùng cho HÀNG TRĂM video sau, chép nguyên văn sẽ khiến video nào cũng lặp
  lại đúng câu cũ. Chỉ trích ra QUY LUẬT trừu tượng (vd: "xưng hô mày/tao xuyên suốt",
  "mở đầu bằng câu hỏi tu từ dồn dập, không quá 5 từ/câu", "không dùng ẩn dụ hoa mỹ,
  đi thẳng vào nỗi đau/ham muốn cụ thể", "kết thúc bằng 1 câu đơn, dứt khoát").
${
  multiSample
    ? `- Có NHIỀU mẫu (${samples.length}) — CHỈ giữ lại pattern LẶP LẠI ở ÍT NHẤT 2-3 mẫu
  trở lên. Pattern chỉ xuất hiện đúng 1 mẫu nhiều khả năng là ngẫu nhiên của video đó,
  không phải công thức chung của kênh — bỏ qua, đừng đưa vào playbook.
- Các mẫu này là kịch bản của KÊNH KHÁC (transcript tự động từ video đối thủ) — chỉ học
  CÁCH VIẾT (giọng văn, cấu trúc, nhịp điệu), không phải NỘI DUNG cụ thể của họ.`
    : ""
}
- Viết playbook dạng chỉ dẫn BẮT BUỘC (dùng "PHẢI", "KHÔNG được", không viết dạng mô
  tả/nhận xét).
- Playbook phải NGẮN GỌN (dưới 200 từ) — đây là chỉ dẫn nhét vào prompt mỗi lần viết
  kịch bản thật, không phải tài liệu phân tích dài.

${
  existingPlaybook?.trim()
    ? `Playbook HIỆN TẠI của kênh này (GIỮ LẠI những gì còn đúng, chỉ bổ sung/tinh chỉnh
theo mẫu mới bên dưới — KHÔNG xoá sạch viết lại từ đầu trừ khi mẫu mới mâu thuẫn rõ
ràng với playbook cũ):
"""
${existingPlaybook.trim()}
"""
`
    : "(Chưa có playbook nào trước đó — viết mới hoàn toàn.)"
}

Bạn đang chạy tự động (non-interactive) — KHÔNG hỏi lại. Dùng tool \`write_file\` để
lưu ĐÚNG 1 file "${OUT_FILE}" ở project root, nội dung JSON dạng:
{"playbook": "..."}
Sau khi ghi file xong, trả lời bằng 1 câu tóm tắt ngắn — không tool call nào nữa.`;

  const userPrompt = [
    `Mô tả ý muốn của user: ${description || "(không có, chỉ dựa vào kịch bản mẫu)"}`,
    "",
    ...samples.flatMap((s, i) => [`--- Kịch bản mẫu ${i + 1}/${samples.length} ---`, s, ""]),
  ].join("\n");

  const result = await runAgent({ systemPrompt, userPrompt, tools, model, stopAfterWrites: 1, onEvent, signal });

  const outPath = join(batchDir, OUT_FILE);
  if (!existsSync(outPath)) {
    const err = new Error(`Không tìm thấy file "${OUT_FILE}" — model không gọi write_file.`);
    err.usage = result.usage;
    throw err;
  }
  const parsed = JSON.parse(readFileSync(outPath, "utf-8"));
  if (!parsed.playbook?.trim()) {
    const err = new Error(`"${OUT_FILE}" thiếu field "playbook".`);
    err.usage = result.usage;
    throw err;
  }

  return { playbook: parsed.playbook.trim(), usage: result.usage };
}
