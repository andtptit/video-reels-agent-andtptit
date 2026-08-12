/**
 * investigation-content-planner agent task — same shape/harness as content-planner.mjs
 * (reuses run-agent.mjs + fs-tools.mjs, writes master_content.md + scenes.json in the
 * exact same contract generate-audio.mjs already reads), just backed by a different
 * skill file: investigative narrative structure (timeline/evidence/impact) instead of
 * content-planner's sales structure (Hook→Pain→Bridge→Value→Proof→CTA). Kept as a
 * separate file rather than a "mode" flag on content-planner.mjs itself — the two
 * skills diverge enough in voice/structure that branching one file's system prompt
 * would be harder to read/maintain than two small parallel files.
 *
 * video-planner.mjs (the NEXT step) is still the only place that decides per-scene
 * image-related fields (photo_keyword/label_text for the investigation_board sub-
 * style, same as it already owns image_prompt/image_tags for AI-image styles) — this
 * file only ever writes narration/meaning/mood_hint/is_hook, identical to
 * content-planner's own scope.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { runAgent, DEFAULT_MODEL } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";
import { checkDurationSum } from "../tools/validators.mjs";

const SKILL_PATH = join(import.meta.dirname, "..", "..", ".agents", "skills", "investigation-content-planner", "SKILL.md");

export async function runInvestigationContentPlanner({
  idea, // chủ đề/vụ việc điều tra, thay cho "idea" của content-planner nhưng cùng vai trò
  projectDir,
  audience,
  platform = "9:16",
  targetDuration = "30–60s",
  contentPlaybook, // see content-planner.mjs's own param doc — same field, same use
  model = DEFAULT_MODEL,
  onEvent,
  signal,
}) {
  const skill = readFileSync(SKILL_PATH, "utf-8");
  const tools = createFsTools(projectDir);

  const systemPrompt = `${skill}

---

Bạn đang chạy tự động (non-interactive) — KHÔNG được hỏi lại user ở "Bước 1", vì
không ai sẽ trả lời. Dùng đúng 3 thông tin cho sẵn trong user message bên dưới.
Dùng tool \`write_file\` để lưu đúng 2 file vào project root (path tương đối, không
có tiền tố thư mục project): \`master_content.md\` và \`scenes.json\`. Sau khi ghi cả
2 file xong, trả lời bằng 1 câu tóm tắt ngắn — không tool call nào nữa.`;

  const userPrompt = [
    `Chủ đề/vụ việc điều tra: ${idea}`,
    `Đối tượng xem: ${audience}`,
    `Platform: ${platform}`,
    `Tổng thời lượng mong muốn: ${targetDuration}`,
    ...(contentPlaybook?.trim()
      ? ["", `Định hướng nội dung riêng của kênh này (BẮT BUỘC tuân theo khi viết kịch bản):`, contentPlaybook.trim()]
      : []),
  ].join("\n");

  const result = await runAgent({ systemPrompt, userPrompt, tools, model, onEvent, signal });

  const outFile = join(projectDir, "scenes.json");
  if (existsSync(outFile)) {
    const scenes = JSON.parse(readFileSync(outFile, "utf-8"));
    const durationCheck = checkDurationSum({
      total: scenes.total_estimated_duration ?? 0,
      scenes: scenes.scenes ?? [],
      key: "estimated_duration",
    });
    if (!durationCheck.ok) onEvent?.({ type: "duration-check", ...durationCheck });
    return { ...result, durationCheck };
  }

  return result;
}
