/**
 * video-planner agent task — reuses .agents/skills/video-planner/SKILL.md verbatim.
 * Input: DESIGN.md + scenes-with-timing.json (both read directly and inlined into
 * the prompt — small, required, no reason to spend a tool-call round-trip on them).
 * Output: video-plan.json, written via the write_file tool.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { runAgent, DEFAULT_MODEL } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";
import { checkDurationSum } from "../tools/validators.mjs";

const SKILL_PATH = join(import.meta.dirname, "..", "..", ".agents", "skills", "video-planner", "SKILL.md");

export async function runVideoPlanner({
  projectDir,
  // "animation" — thuần CSS/GSAP như hiện tại (mặc định, không đổi hành vi cũ).
  // "ai-image" — mỗi scene có thêm 1 ảnh nền sinh bằng AI (wan2.6-image), scene-writer
  // sẽ tải ảnh dựa trên field `image_prompt` mà bước này viết ra.
  visualStyle = "animation",
  model = DEFAULT_MODEL,
  maxTurns = 8,
  onEvent,
}) {
  const skill = readFileSync(SKILL_PATH, "utf-8");
  const design = readFileSync(join(projectDir, "DESIGN.md"), "utf-8");
  const scenesWithTiming = readFileSync(join(projectDir, "scenes-with-timing.json"), "utf-8");
  const tools = createFsTools(projectDir);

  const imageStyleOverride =
    visualStyle === "ai-image"
      ? `

---

Style video này dùng ẢNH NỀN SINH BẰNG AI cho mỗi scene (không phải thuần CSS/GSAP).
Với MỖI scene trong \`video-plan.json\`, thêm field \`"image_prompt"\`: 1 câu mô tả ảnh
nền (tiếng Anh, để model sinh ảnh hiểu đúng) theo đúng các quy tắc sau:

- Mô tả ĐÚNG màu sắc/mood/phong cách đã đọc trong DESIGN.md bên dưới (không tự bịa màu
  khác) — đây là cách duy nhất để ảnh khớp thương hiệu, vì bước sinh ảnh không tự đọc
  lại DESIGN.md.
- TUYỆT ĐỐI không có chữ/số/watermark trong ảnh (\`"no text, no words, no watermark"\`
  luôn có ở cuối mỗi prompt) — chữ thật sẽ do HTML overlay lên trên.
- Chừa khoảng trống thị giác (negative space) ở giữa hoặc 1 phía cho text overlay đọc
  được — nói rõ trong prompt (vd \`"empty center for text overlay"\`).
- DÙNG CHUNG 1 cụm mô tả phong cách (style clause) ở cuối MỌI prompt của video này (chỉ
  đổi phần chủ thể/composition mỗi scene) — để ảnh các scene nhất quán phong cách với
  nhau, không đổi tone giữa các cảnh.
- 1 câu, súc tích, không quá 300 ký tự.`
      : "";

  const systemPrompt = `${skill}

---

Bạn đang chạy tự động (non-interactive). Dùng tool \`write_file\` để lưu đúng 1 file
vào project root (path tương đối, không tiền tố project): \`video-plan.json\`. Sau khi
ghi xong, trả lời bằng 1 câu tóm tắt — không tool call nào nữa.

DESIGN.md và scenes-with-timing.json đã được nhúng đầy đủ trong user message bên dưới
— KHÔNG gọi \`read_file\` cho 2 file này nữa, chỉ lãng phí turn.${imageStyleOverride}`;

  const userPrompt = `DESIGN.md:\n${design}\n\n---\n\nscenes-with-timing.json:\n${scenesWithTiming}`;

  // Heaviest single-call task in the pipeline (detailed visual_brief + elements +
  // sfx_picks per scene, often 8+ scenes) — confirmed live that the DashScope global
  // default (was 90s) wasn't enough: 3 separate real runs each burned the full 90s ×
  // 3 retries and still got AbortError, so the model was still generating, not stuck.
  // Give this one extra headroom beyond the (now-raised) global default.
  const result = await runAgent({ systemPrompt, userPrompt, tools, model, maxTurns, onEvent, timeoutMs: 240_000 });

  const outFile = join(projectDir, "video-plan.json");
  if (existsSync(outFile)) {
    const plan = JSON.parse(readFileSync(outFile, "utf-8"));
    const durationCheck = checkDurationSum({ total: plan.total_duration ?? 0, scenes: plan.scenes ?? [], key: "duration" });
    if (!durationCheck.ok) onEvent?.({ type: "duration-check", ...durationCheck });
    return { ...result, durationCheck };
  }

  return result;
}
