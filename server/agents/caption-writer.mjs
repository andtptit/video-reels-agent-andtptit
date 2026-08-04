/**
 * Caption-writer agent — final "ready to publish" companion to the rendered MP4:
 * an Instagram Reels caption + hashtags the user can copy-paste straight into the
 * post composer (see Pipeline.jsx's Copy button). Confirmed with user: single
 * Reels-only version (no per-platform variants), caption + hashtags together.
 *
 * Input is `master_content.md` (the full narration/screenplay already written by
 * content-planner) + DESIGN.md (brand voice) — both already exist by content-planner
 * time, so this step has no hard dependency on render finishing first, but is placed
 * after Render in the UI because "video + caption together" is the natural
 * ready-to-post bundle (see plan.md).
 *
 * CHEAP_MODEL, not DEFAULT_MODEL — this is repackaging already-written narration
 * into a different format, not original creative planning (same cost tier as
 * scene-writer/root-composer).
 */
import { runAgent, CHEAP_MODEL } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";

export async function runCaptionWriter({ projectDir, masterContent, design, model = CHEAP_MODEL, maxTurns = 4, onEvent }) {
  const tools = createFsTools(projectDir);

  const systemPrompt = `Bạn là chuyên gia viết caption Instagram Reels tiếng Việt.
Nhiệm vụ: đọc kịch bản video (narration) trong user message bên dưới, viết 1 caption
THẬT SỰ sẵn sàng đăng kèm hashtag.

Caption phải:
- Mở đầu bằng 1 câu hook ngắn KHÁC với câu mở đầu narration (không copy y nguyên) —
  vai trò câu này là dừng ngón tay lướt, không phải tóm tắt lại video.
- Bổ sung thêm ngữ cảnh/giá trị NGOÀI những gì đã nói trong video — không lặp lại y
  nguyên narration, để người đọc thấy đáng đọc thêm caption chứ không chỉ xem video.
- Giọng văn khớp DESIGN.md cho sẵn.
- Kết bằng 1 câu kêu gọi hành động ngắn (lưu lại / theo dõi / để lại bình luận...).
- Độ dài vừa cho Reels — khoảng 3-6 dòng ngắn, KHÔNG viết thành đoạn văn dài.
- Emoji dùng tiết chế nếu hợp giọng văn, không lạm dụng.

Hashtag:
- ĐÚNG 8-12 hashtag (tiếng Việt và/hoặc tiếng Anh) phù hợp nội dung, trộn cả tag ngách
  hẹp (đúng chủ đề cụ thể của video) lẫn tag rộng (dễ tiếp cận hơn) — không tự bịa tag
  không liên quan tới nội dung.

Bạn đang chạy tự động (non-interactive) — KHÔNG được hỏi lại vì không ai trả lời. Dùng
tool \`write_file\` để lưu đúng 1 file vào project root (path tương đối, không tiền
tố): \`caption.md\`. Nội dung file PHẢI sẵn sàng copy-paste THẲNG vào ô caption Reels —
TUYỆT ĐỐI KHÔNG thêm tiêu đề markdown (không "## Caption"), không giải thích, không
chú thích gì ngoài đúng 2 phần cách nhau 1 dòng trống:

[caption text nhiều dòng]

[hashtag cách nhau bởi dấu cách, ví dụ: #tag1 #tag2 #tag3]

Sau khi ghi file xong, trả lời bằng 1 câu tóm tắt ngắn — không tool call nào nữa.`;

  const userPrompt = `Narration (master_content.md):\n${masterContent}\n\n---\n\nDESIGN.md:\n${design}`;

  return runAgent({ systemPrompt, userPrompt, tools, model, maxTurns, onEvent, stopAfterWrites: 1 });
}
