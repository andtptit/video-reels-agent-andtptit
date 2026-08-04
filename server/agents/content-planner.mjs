/**
 * content-planner agent task — reuses .agents/skills/content-planner/SKILL.md
 * verbatim as the system prompt (same instructions Claude Code follows), so the
 * output convention (master_content.md screenplay + scenes.json) stays identical
 * regardless of which LLM runs it.
 *
 * The skill's own "Bước 1 — Xác nhận 3 thứ" assumes an interactive user; this
 * automated path answers those 3 questions up front via the caller's params
 * instead, and instructs the model not to ask anything back.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { runAgent, DEFAULT_MODEL } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";
import { checkDurationSum } from "../tools/validators.mjs";

const SKILL_PATH = join(import.meta.dirname, "..", "..", ".agents", "skills", "content-planner", "SKILL.md");

export async function runContentPlanner({
  idea,
  projectDir,
  audience,
  platform = "9:16",
  targetDuration = "30–60s",
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
    `Ý tưởng: ${idea}`,
    `Đối tượng xem: ${audience}`,
    `Platform: ${platform}`,
    `Tổng thời lượng mong muốn: ${targetDuration}`,
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
