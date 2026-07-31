/**
 * video-planner agent task — reuses .agents/skills/video-planner/SKILL.md verbatim.
 * Input: DESIGN.md + scenes-with-timing.json (both read directly and inlined into
 * the prompt — small, required, no reason to spend a tool-call round-trip on them).
 * Output: video-plan.json, written via the write_file tool.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { runAgent } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";

const SKILL_PATH = join(import.meta.dirname, "..", "..", ".agents", "skills", "video-planner", "SKILL.md");

export async function runVideoPlanner({ projectDir, model = "qwen-plus", maxTurns = 8, onEvent }) {
  const skill = readFileSync(SKILL_PATH, "utf-8");
  const design = readFileSync(join(projectDir, "DESIGN.md"), "utf-8");
  const scenesWithTiming = readFileSync(join(projectDir, "scenes-with-timing.json"), "utf-8");
  const tools = createFsTools(projectDir);

  const systemPrompt = `${skill}

---

Bạn đang chạy tự động (non-interactive). Dùng tool \`write_file\` để lưu đúng 1 file
vào project root (path tương đối, không tiền tố project): \`video-plan.json\`. Sau khi
ghi xong, trả lời bằng 1 câu tóm tắt — không tool call nào nữa.`;

  const userPrompt = `DESIGN.md:\n${design}\n\n---\n\nscenes-with-timing.json:\n${scenesWithTiming}`;

  return runAgent({ systemPrompt, userPrompt, tools, model, maxTurns, onEvent });
}
