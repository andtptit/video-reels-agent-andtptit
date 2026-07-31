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

export async function runVideoPlanner({ projectDir, model = DEFAULT_MODEL, maxTurns = 8, onEvent }) {
  const skill = readFileSync(SKILL_PATH, "utf-8");
  const design = readFileSync(join(projectDir, "DESIGN.md"), "utf-8");
  const scenesWithTiming = readFileSync(join(projectDir, "scenes-with-timing.json"), "utf-8");
  const tools = createFsTools(projectDir);

  const systemPrompt = `${skill}

---

Bạn đang chạy tự động (non-interactive). Dùng tool \`write_file\` để lưu đúng 1 file
vào project root (path tương đối, không tiền tố project): \`video-plan.json\`. Sau khi
ghi xong, trả lời bằng 1 câu tóm tắt — không tool call nào nữa.

DESIGN.md và scenes-with-timing.json đã được nhúng đầy đủ trong user message bên dưới
— KHÔNG gọi \`read_file\` cho 2 file này nữa, chỉ lãng phí turn.`;

  const userPrompt = `DESIGN.md:\n${design}\n\n---\n\nscenes-with-timing.json:\n${scenesWithTiming}`;

  const result = await runAgent({ systemPrompt, userPrompt, tools, model, maxTurns, onEvent });

  const outFile = join(projectDir, "video-plan.json");
  if (existsSync(outFile)) {
    const plan = JSON.parse(readFileSync(outFile, "utf-8"));
    const durationCheck = checkDurationSum({ total: plan.total_duration ?? 0, scenes: plan.scenes ?? [], key: "duration" });
    if (!durationCheck.ok) onEvent?.({ type: "duration-check", ...durationCheck });
    return { ...result, durationCheck };
  }

  return result;
}
