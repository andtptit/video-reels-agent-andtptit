/**
 * scene-writer agent task — reuses .agents/skills/hyperframes/SKILL.md verbatim as
 * the base authoring instructions, plus this repo's own project-specific overrides
 * from CLAUDE.md ("Conventions Bắt Buộc": #scene-NN selector instead of
 * [data-composition-id], .sN- class prefix, repeat: Math.ceil never -1).
 *
 * Includes the mandatory validation gate from the approved plan: after each write,
 * run `hyperframes lint` and feed any NEW findings (diffed against a baseline lint
 * taken before this agent touched anything) back to the model for up to
 * `maxFixAttempts` auto-fix rounds. Diffing against a baseline — rather than
 * requiring the whole project to lint clean — matters because a project mid-pipeline
 * commonly has pre-existing findings unrelated to this scene (e.g. other scenes not
 * written yet, root index.html not wired up until step 6); blocking on those would
 * make convergence impossible through no fault of this scene's HTML.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { runAgent } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";
import { lint } from "../tools/hyperframes-cli.mjs";

const SKILL_PATH = join(import.meta.dirname, "..", "..", ".agents", "skills", "hyperframes", "SKILL.md");

function findingKey(f) {
  return `${f.code}::${f.message}`;
}

function diffNewFindings(baseline, current) {
  const baseKeys = new Set((baseline?.findings ?? []).map(findingKey));
  return (current.findings ?? []).filter((f) => !baseKeys.has(findingKey(f)));
}

function sceneNumber(sceneId) {
  const digits = sceneId.match(/\d+/)?.[0] ?? "1";
  return parseInt(digits, 10);
}

export async function runSceneWriter({
  projectDir,
  scene, // one entry from video-plan.json.scenes
  design, // DESIGN.md content (caller reads it once and shares across scenes)
  model = "qwen-plus",
  maxTurns = 6,
  maxFixAttempts = 3,
  onEvent,
}) {
  const skill = readFileSync(SKILL_PATH, "utf-8");
  const tools = createFsTools(projectDir);

  const n = sceneNumber(scene.sceneId);
  const padded = String(n).padStart(2, "0");
  const selector = `#scene-${padded}`;
  const classPrefix = `.s${n}-`;
  const outPath = `compositions/scene_${padded}.html`;

  const systemPrompt = `${skill}

---

Bạn đang viết MỘT sub-composition cho một scene, KHÔNG phải root composition. Đây là
override bắt buộc riêng của project này (cao hơn hướng dẫn chung ở trên):

- CSS selector cho sub-composition: \`${selector}\` — KHÔNG dùng \`[data-composition-id="..."]\`
- Class prefix cho mọi class trong scene này: \`${classPrefix}\` (ví dụ \`${classPrefix}title\`)
- \`repeat: Math.ceil(...)\` — KHÔNG BAO GIỜ dùng \`repeat: -1\`
- Mọi element có timing phải có \`class="clip"\`
- \`data-duration\` của composition = đúng \`scene.duration\` đã cho, không tự đổi

Bạn đang chạy tự động (non-interactive). Dùng tool \`write_file\` để lưu đúng 1 file
vào project root (path tương đối, không tiền tố project): \`${outPath}\`. Sau khi ghi
xong, trả lời bằng 1 câu tóm tắt — không tool call nào nữa.`;

  const basePrompt = `DESIGN.md:\n${design}\n\n---\n\nvideo-plan.json scene "${scene.sceneId}":\n${JSON.stringify(scene, null, 2)}`;

  const baseline = await lint(projectDir);
  let lastNewFindings = [];
  let agentResult;

  for (let attempt = 0; attempt <= maxFixAttempts; attempt++) {
    const userPrompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\n---\n\nLần viết trước (attempt ${attempt}) có lỗi lint MỚI (không tính lỗi có sẵn của project):\n${JSON.stringify(lastNewFindings, null, 2)}\n\nSửa lại đúng file ${outPath} để hết các lỗi này. Không giải thích — sửa trực tiếp.`;

    agentResult = await runAgent({ systemPrompt, userPrompt, tools, model, maxTurns, onEvent });

    const current = await lint(projectDir);
    lastNewFindings = diffNewFindings(baseline, current);
    onEvent?.({ type: "lint", attempt, newFindingCount: lastNewFindings.length });

    if (lastNewFindings.length === 0) {
      return { ok: true, attempts: attempt + 1, outPath, agentResult };
    }
  }

  return { ok: false, attempts: maxFixAttempts + 1, outPath, newFindings: lastNewFindings, agentResult };
}
