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
import { readFileSync, mkdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { runAgent, CHEAP_MODEL } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";
import { lint } from "../tools/hyperframes-cli.mjs";
import { checkPseudoElementAnimations, checkCanvasDimensions, checkClipClassOverride } from "../tools/validators.mjs";
import { dimensionsForFormat } from "../lib/canvas.mjs";
import { generateAndSaveImage } from "../providers/image/dashscope-image.mjs";
import { findReusableImage, addToLibrary, copyFromLibrary, tryReserveReuseSlot } from "../lib/image-library.mjs";

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
  format, // video-plan.json's top-level `format` ("9:16" | "16:9") — caller passes
  // this through so every scene in the project targets the same canvas; defaults to
  // "9:16" only if the caller genuinely has no format (dimensionsForFormat's own
  // fallback), not because scenes should ever silently disagree with each other.
  model = CHEAP_MODEL,
  imageModel, // DashScope image model id — undefined lets generateAndSaveImage fall
  // back to its own env-configured default (DASHSCOPE_MODEL_IMAGE / "wan2.6-image")
  imageLibrary, // { enabled, maxReuse, profileSlug } from video-plan.json — see
  // lib/image-library.mjs. Was previously wired ONLY into sub-scene-writer.mjs even
  // though video-planner.mjs writes `image_tags` for this ("motion" + ai-image) style
  // too — confirmed live this meant the motion+ai-image path always paid for a fresh
  // generation while the identically-tagged "sub" path reused for free. Same fix,
  // mirrored here.
  maxTurns = 6,
  maxFixAttempts = 3,
  onEvent,
  signal,
}) {
  const skill = readFileSync(SKILL_PATH, "utf-8");
  const tools = createFsTools(projectDir);

  const n = sceneNumber(scene.sceneId);
  const padded = String(n).padStart(2, "0");
  const compositionId = `scene-${padded}`;
  const selector = `#${compositionId}`;
  const classPrefix = `.s${n}-`;
  const outPath = `compositions/scene_${padded}.html`;
  const { width, height } = dimensionsForFormat(format);

  // AI-image style: video-planner already wrote `image_prompt` per scene (style-aware,
  // consistent across the whole video — see video-planner.mjs). Generate + download
  // BEFORE the agent runs, not as a tool it calls mid-conversation, so the agent never
  // has to wait on/retry a slow external call inside its own turn budget, and the file
  // is guaranteed to exist by the time the prompt below references its path.
  let imagePath = null;
  if (scene.image_prompt) {
    imagePath = `assets/images/scene_${padded}.png`;
    const imageAbsPath = join(projectDir, imagePath);
    mkdirSync(join(projectDir, "assets", "images"), { recursive: true });

    let imageResult;
    if (existsSync(imageAbsPath)) {
      // Already generated (or already reused) in a prior run.
      imageResult = { destPath: imageAbsPath, bytes: statSync(imageAbsPath).size, skipped: true };
    } else if (imageLibrary?.enabled) {
      const match = findReusableImage({ profileSlug: imageLibrary.profileSlug, format, tags: scene.image_tags });
      if (match && tryReserveReuseSlot(projectDir, imageLibrary.maxReuse)) {
        imageResult = copyFromLibrary(match, imageAbsPath);
      }
    }
    if (!imageResult) {
      imageResult = await generateAndSaveImage({
        prompt: scene.image_prompt,
        format,
        destPath: imageAbsPath,
        signal,
        ...(imageModel ? { model: imageModel } : {}),
      });
      // Only a genuinely fresh generation is worth banking — see sub-scene-writer.mjs's
      // identical comment for why skip-if-exists/reused entries aren't re-added.
      if (!imageResult.skipped && imageLibrary?.enabled) {
        addToLibrary({
          profileSlug: imageLibrary.profileSlug,
          format,
          tags: scene.image_tags,
          prompt: scene.image_prompt,
          srcImagePath: imageAbsPath,
        });
      }
    }
    onEvent?.({
      type: imageResult.reusedFromLibrary ? "image-reused" : imageResult.skipped ? "image-skip" : "image",
      outPath: imagePath,
    });
  }

  const imageOverride = imagePath
    ? `

---

Scene này dùng ẢNH NỀN AI (đã sinh sẵn, không tự tạo ảnh khác): \`${imagePath}\`, kích
thước ĐÃ ĐÚNG ${width}×${height} khớp canvas. Bắt buộc:

- Chèn \`<img id="${classPrefix.slice(1)}bg-image" src="${imagePath}" class="clip"
  data-start="0" data-duration="${scene.duration}" data-track-index="0"
  style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
  z-index:0;" alt="">\` — LUÔN đứng ĐẦU TIÊN trong DOM (trước mọi element chữ khác),
  \`id\` bắt buộc và phải duy nhất, data-track-index="0" (không dùng track 0 cho
  element nào khác).
- Text/element khác nằm TRÊN ảnh — thêm \`z-index\` lớn hơn 0 cho container chữ (ví dụ
  \`z-index:10\`) để không bị ảnh che.
- KHÔNG thêm lại atmosphere layer nào tự vẽ (dot-grid, glow...) đè lên ảnh — ảnh đã
  đóng vai trò nền, tránh xung đột thị giác.`
    : "";

  const systemPrompt = `${skill}

---

Bạn đang viết MỘT sub-composition cho một scene, KHÔNG phải root composition. Đây là
override bắt buộc riêng của project này (cao hơn hướng dẫn chung ở trên):

- Element gốc (wrapper) của sub-composition PHẢI có ĐÚNG CẢ HAI:
  \`id="${compositionId}"\` VÀ \`data-composition-id="${compositionId}"\` (dùng dấu gạch
  ngang "-", ví dụ \`${compositionId}\`) — LƯU Ý: đây KHÁC với \`sceneId\` trong dữ liệu
  scene bên dưới (\`"${scene.sceneId}"\`, dùng dấu gạch dưới "_") — \`sceneId\` chỉ là tên
  field input, KHÔNG được dùng làm giá trị \`id\`/\`data-composition-id\`.
- \`window.__timelines\` phải đăng ký ĐÚNG cùng giá trị đó:
  \`window.__timelines["${compositionId}"] = tl\` — key này phải khớp CHÍNH XÁC với
  \`id\`/\`data-composition-id\` ở trên, nếu không hyperframes lint sẽ báo lỗi
  \`timeline_id_mismatch\`.
- CSS selector để style: \`${selector}\`
- Class prefix cho mọi class trong scene này: \`${classPrefix}\` (ví dụ \`${classPrefix}title\`)
- \`repeat: Math.ceil(...)\` — KHÔNG BAO GIỜ dùng \`repeat: -1\`
- Mọi element có timing phải có \`class="clip"\`
- TUYỆT ĐỐI KHÔNG tự viết CSS rule cho class \`.clip\` (vd \`.clip { position: absolute;
  ... }\`) — đây là marker riêng của framework để quản lý hiện/ẩn theo thời gian, tự định
  nghĩa CSS cho nó (nhất là \`position\`) sẽ phá cách framework mount kích thước, khiến
  nội dung bị co lại/dồn góc. Cần định vị gì thì dùng class riêng của bạn.
- \`data-duration\` của composition = đúng \`scene.duration\` đã cho, không tự đổi
- Kích thước canvas của TOÀN BỘ project là \`data-width="${width}" data-height="${height}"\`
  — element gốc của sub-composition PHẢI dùng ĐÚNG 2 số này (khớp \`format\` của
  project), KHÔNG tự đoán hay dùng số khác. Toàn bộ layout/font-size/vị trí bên trong
  phải được thiết kế vừa khung ${width}×${height}, không chỉ đặt đúng attribute rồi bỏ
  mặc nội dung tràn/lệch.${imageOverride}

Bạn đang chạy tự động (non-interactive). Dùng tool \`write_file\` để lưu đúng 1 file
vào project root (path tương đối, không tiền tố project): \`${outPath}\`. Sau khi ghi
xong, trả lời bằng 1 câu tóm tắt — không tool call nào nữa.`;

  const basePrompt = `DESIGN.md:\n${design}\n\n---\n\nvideo-plan.json scene "${scene.sceneId}":\n${JSON.stringify(scene, null, 2)}`;

  const baseline = await lint(projectDir);
  let lastNewFindings = [];
  let agentResult;
  // Carries the conversation across fix attempts (see run-agent.mjs's priorMessages
  // doc) so retries send only the new lint findings, not the full skill + scene data
  // again — confirmed live that re-sending was pure waste (~7.8k tokens/attempt) since
  // the model already has all of it in context from attempt 0.
  let priorMessages = null;
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 };
  const addUsage = (u) => {
    if (!u) return;
    usage.promptTokens += u.promptTokens ?? 0;
    usage.completionTokens += u.completionTokens ?? 0;
    usage.totalTokens += u.totalTokens ?? 0;
    usage.apiCalls += u.apiCalls ?? 0;
  };

  for (let attempt = 0; attempt <= maxFixAttempts; attempt++) {
    const userPrompt =
      attempt === 0
        ? basePrompt
        : `Lần viết trước (attempt ${attempt}) có lỗi MỚI cần sửa (lint và/hoặc kích thước canvas sai — không tính lỗi có sẵn của project):\n${JSON.stringify(lastNewFindings, null, 2)}\n\nSửa lại đúng file ${outPath} để hết các lỗi này. Không giải thích — sửa trực tiếp.`;

    try {
      // stopAfterWrites: 1 — this task only ever writes 1 file (outPath); stop the
      // instant that write succeeds instead of letting the model keep calling
      // write_file on its own judgment (see run-agent.mjs's doc for the real
      // incident this fixes: 184k tokens burned on a scene already lint-clean
      // after its first write).
      agentResult = await runAgent({ systemPrompt, userPrompt, tools, model, maxTurns, onEvent, priorMessages, stopAfterWrites: 1, signal });
    } catch (err) {
      addUsage(err.usage);
      err.usage = { ...usage };
      throw err;
    }
    priorMessages = agentResult.messages;
    addUsage(agentResult.usage);

    const current = await lint(projectDir);
    const html = readFileSync(join(projectDir, outPath), "utf-8");
    // Dimension mismatches are folded into the same retry gate as lint findings —
    // hyperframes lint checks each file in isolation so it can never catch a scene
    // disagreeing with the project's own canvas size (see validators.mjs). Treating
    // it as a hard-fail here, not just a warning, is what actually guarantees the fix
    // instead of hoping the model follows the prompt instruction.
    lastNewFindings = [
      ...diffNewFindings(baseline, current),
      ...checkCanvasDimensions(html, width, height),
      ...checkClipClassOverride(html),
    ];
    onEvent?.({ type: "lint", attempt, newFindingCount: lastNewFindings.length });

    if (lastNewFindings.length === 0) {
      const staticWarnings = checkPseudoElementAnimations(html);
      if (staticWarnings.length) onEvent?.({ type: "static-check", outPath, staticWarnings });
      return { ok: true, attempts: attempt + 1, outPath, agentResult, staticWarnings, usage };
    }
  }

  return { ok: false, attempts: maxFixAttempts + 1, outPath, newFindings: lastNewFindings, agentResult, usage };
}
