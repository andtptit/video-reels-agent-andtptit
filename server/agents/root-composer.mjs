/**
 * root-composer agent task — automates CLAUDE.md step 6 ("Viết root index.html"),
 * the one step in the pipeline that was NOT automated by content-planner/video-planner/
 * scene-writer. Confirmed live via the UI: without this step, `index.html` stays the
 * blank `hyperframes init` scaffold (a bare 10s empty composition), so `/render`
 * "succeeds" but produces a black video — the scene sub-compositions exist on disk but
 * nothing in the root timeline ever references them.
 *
 * Reuses .agents/skills/hyperframes/SKILL.md verbatim, same as scene-writer.mjs, plus
 * a project-specific override for root-composition conventions (atmosphere tracks 0-6,
 * music track 20, voiceover track 21, scene clips tracks 10/11 alternating, 0.3s
 * crossfade) and a real worked example pulled from a project a human previously
 * authored correctly through Claude Code — concrete numbers beat prose for this kind
 * of layout-heavy authoring task.
 *
 * Same validation gate as scene-writer: lint baseline before writing, diff new
 * findings after each attempt, feed them back for up to maxFixAttempts auto-fix
 * rounds.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { runAgent, CHEAP_MODEL } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";
import { lint } from "../tools/hyperframes-cli.mjs";
import { checkPseudoElementAnimations } from "../tools/validators.mjs";

const SKILL_PATH = join(import.meta.dirname, "..", "..", ".agents", "skills", "hyperframes", "SKILL.md");

// From output/2026-05-16/huong-dan-cau-hinh-claude-xay-kenh-marketing-mien-/video/index.html
// (authored correctly by a human via Claude Code + /hyperframes in an earlier session)
// — trimmed to the <body> essentials so the prompt stays focused on structure, not CSS.
const WORKED_EXAMPLE = `<div id="root" data-composition-id="main" data-start="0" data-duration="29" data-width="1080" data-height="1920">
  <!-- Atmosphere: tracks 0–6, full duration -->
  <div id="bg-dots"      class="clip bg-dots"      data-start="0" data-duration="29" data-track-index="0"></div>
  <div id="bg-glow"      class="clip bg-glow"      data-start="0" data-duration="29" data-track-index="1"></div>
  <div id="bg-scanlines" class="clip bg-scanlines" data-start="0" data-duration="29" data-track-index="2"></div>
  <div id="corner-tl"    class="clip corner corner-tl" data-start="0" data-duration="29" data-track-index="3"></div>
  <div id="corner-tr"    class="clip corner corner-tr" data-start="0" data-duration="29" data-track-index="4"></div>
  <div id="corner-bl"    class="clip corner corner-bl" data-start="0" data-duration="29" data-track-index="5"></div>
  <div id="corner-br"    class="clip corner corner-br" data-start="0" data-duration="29" data-track-index="6"></div>

  <!-- Music: track 20 -->
  <audio id="bg-music" class="clip" data-start="0" data-duration="29" data-track-index="20" data-volume="0.18" src="assets/music/upbeat-tech.mp3"></audio>

  <!-- Voiceover: track 21, data-start = the SAME crossfade-adjusted start as its scene -->
  <audio id="vo-01" class="clip" data-start="0.0"  data-duration="2.6" data-track-index="21" data-volume="1.0" src="assets/audio/scene_01_vo.mp3"></audio>
  <audio id="vo-02" class="clip" data-start="2.6"  data-duration="5.3" data-track-index="21" data-volume="1.0" src="assets/audio/scene_02_vo.mp3"></audio>
  <audio id="vo-03" class="clip" data-start="7.9"  data-duration="7.3" data-track-index="21" data-volume="1.0" src="assets/audio/scene_03_vo.mp3"></audio>

  <!-- Scenes: tracks 10/11 alternating, data-start crossfades 0.3s into the previous scene -->
  <div id="scene-01" class="clip" data-composition-id="scene-01" data-composition-src="compositions/scene_01.html" data-start="0"    data-duration="2.9" data-track-index="10" data-width="1080" data-height="1920"></div>
  <div id="scene-02" class="clip" data-composition-id="scene-02" data-composition-src="compositions/scene_02.html" data-start="2.6"  data-duration="5.6" data-track-index="11" data-width="1080" data-height="1920"></div>
  <div id="scene-03" class="clip" data-composition-id="scene-03" data-composition-src="compositions/scene_03.html" data-start="7.9"  data-duration="7.6" data-track-index="10" data-width="1080" data-height="1920"></div>
</div>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  tl.from('#bg-dots', { opacity: 0, duration: 1.2, ease: 'power2.out' }, 0);
  // ... other atmosphere entrances ...

  // Crossfade: fade out right as the NEXT scene's voiceover starts, hard-kill 0.3s later
  tl.to('#scene-01',  { opacity: 0, duration: 0.3, ease: 'power2.inOut' }, 2.6);
  tl.set('#scene-01', { opacity: 0 }, 2.9);
  tl.to('#scene-02',  { opacity: 0, duration: 0.3, ease: 'power2.inOut' }, 7.9);
  tl.set('#scene-02', { opacity: 0 }, 8.2);

  window.__timelines['main'] = tl;
</script>`;

function findingKey(f) {
  return `${f.code}::${f.message}`;
}

function diffNewFindings(baseline, current) {
  const baseKeys = new Set((baseline?.findings ?? []).map(findingKey));
  return (current.findings ?? []).filter((f) => !baseKeys.has(findingKey(f)));
}

/**
 * @param {object} params
 * @param {string} params.projectDir
 * @param {string} params.design - DESIGN.md content
 * @param {object} params.scenesWithTiming - parsed scenes-with-timing.json
 * @param {string[]} params.doneSceneIds - sceneIds whose sub-composition already
 *   passed scene-writer successfully; the caller (routes.mjs) is responsible for
 *   filtering this from job-status — root-composer only ever wires exactly these.
 */
export async function runRootComposer({
  projectDir,
  design,
  scenesWithTiming,
  doneSceneIds,
  model = CHEAP_MODEL,
  // Was 8 — confirmed live that's too tight: the model spent 6 of 8 turns re-reading
  // index.html/compositions/*.html/assets/* via read_file/list_dir even though all
  // of that is already inlined in the prompt (see the "KHÔNG gọi read_file" note
  // above), leaving only 2 turns for write_file and hitting the cap before it could
  // send a final non-tool-call message. The prompt now explicitly tells it not to
  // re-read; this bump is just a safety margin on top of that fix.
  maxTurns = 12,
  maxFixAttempts = 3,
  onEvent,
}) {
  if (!doneSceneIds?.length) {
    throw new Error("No successfully generated scenes to compose into root index.html");
  }

  const skill = readFileSync(SKILL_PATH, "utf-8");
  const tools = createFsTools(projectDir);

  const doneScenes = (scenesWithTiming.scenes ?? []).filter((s) => doneSceneIds.includes(s.sceneId));

  const systemPrompt = `${skill}

---

Bạn đang viết ROOT composition (\`index.html\` ở gốc project), KHÔNG phải sub-composition.
Đây là override bắt buộc riêng của project này (cao hơn hướng dẫn chung ở trên), theo
đúng "Conventions Bắt Buộc" trong CLAUDE.md:

- Atmosphere (bg-dots, bg-glow, scanlines, 4 góc...) — \`data-track-index\` 0–6,
  \`data-start="0"\`, \`data-duration\` = tổng thời lượng toàn video (tổng \`scene_duration\`
  của các scene được ghép, tính crossfade — xem cách tính bên dưới)
- Background music — \`data-track-index="20"\`, thẻ \`<audio>\`, \`data-volume\` lấy từ
  \`music_volume\` cho sẵn trong dữ liệu
- Voiceover mỗi scene — \`data-track-index="21"\` (dùng lại track, KHÔNG overlap thời
  gian), \`data-start\` = ĐÚNG BẰNG \`data-start\` của scene tương ứng (đã tính crossfade —
  xem bên dưới), \`data-duration\` = đúng \`vo_duration\` của scene đó (KHÔNG cộng buffer
  0.5s). LƯU Ý: field \`voiceover_start\` trong dữ liệu scenes-with-timing.json là mốc
  tích luỹ CHƯA áp dụng crossfade — không dùng thẳng field đó, phải tự tính lại theo
  quy tắc crossfade bên dưới.
- Scene clips — \`<div class="clip" data-composition-id="scene-NN" data-composition-src="compositions/scene_NN.html">\`,
  xen kẽ \`data-track-index\` 10/11, \`data-duration\` = đúng \`scene_duration\` cho sẵn (đã
  gồm buffer 0.5s, KHÔNG tự đổi)
- Cách tính \`data-start\` có crossfade: scene đầu tiên \`data-start="0"\`. Mỗi scene sau
  bắt đầu sớm hơn 0.3s so với thời điểm scene liền trước "hết hạn"
  (\`data-start[i] = data-start[i-1] + scene_duration[i-1] - 0.3\`)
- Crossfade GSAP: tại đúng thời điểm scene sau bắt đầu, \`tl.to('#scene-i', {opacity:0,
  duration:0.3, ease:'power2.inOut'}, <thời điểm đó>)\`, rồi \`tl.set('#scene-i',
  {opacity:0}, <thời điểm đó + 0.3>)\` để hard-kill ngay sau khi fade xong (scene cuối
  cùng không cần crossfade fade-out)
- CHỈ ghép ĐÚNG danh sách scene cho sẵn bên dưới (đã lọc — chỉ gồm scene generate thành
  công qua bước trước), bỏ qua mọi scene khác dù video-plan.json có liệt kê
- \`repeat: Math.ceil(...)\` — KHÔNG BAO GIỜ dùng \`repeat: -1\`
- Mỗi scene trong \`compositions/scene_NN.html\` LUÔN có \`data-composition-id="scene-NN"\`
  (đúng số thứ tự trong tên file, số 0 ở đầu nếu có — quy ước bắt buộc, do chính
  scene-writer tạo ra) — KHÔNG cần \`read_file\` để kiểm tra lại, cứ dùng đúng
  \`data-composition-id\`/\`data-composition-src\` theo \`sceneId\` cho sẵn trong danh sách
  scene bên dưới

DESIGN.md, danh sách scene (kèm đủ \`vo_duration\`/\`scene_duration\`/đường dẫn audio), và
tên nhạc nền ĐÃ được nhúng đầy đủ trong user message bên dưới — KHÔNG gọi \`read_file\`
hay \`list_dir\` để kiểm tra lại các thông tin này, chỉ lãng phí lượt gọi. Chỉ cần
\`write_file\` để ghi \`index.html\`.

Ví dụ 1 root index.html đã viết đúng (project khác, chỉ để tham khảo CẤU TRÚC — số liệu
khác nhau, đừng copy số, chỉ copy cách tổ chức track/crossfade):

\`\`\`html
${WORKED_EXAMPLE}
\`\`\`

Bạn đang chạy tự động (non-interactive). Dùng tool \`write_file\` để lưu đúng 1 file vào
project root (path tương đối, không tiền tố project): \`index.html\`. Sau khi ghi xong,
trả lời bằng 1 câu tóm tắt — không tool call nào nữa.`;

  const basePrompt = [
    `DESIGN.md:\n${design}`,
    `Danh sách scene cần ghép (đã lọc, chỉ scene generate thành công), mỗi scene có sẵn
\`_audio.vo_duration\`, \`_audio.scene_duration\`, \`_audio.voiceover\` (đường dẫn mp3):\n${JSON.stringify(doneScenes, null, 2)}`,
    `Nhạc nền: ${scenesWithTiming._audio?.music_track ?? "(không có)"}, volume ${scenesWithTiming._audio?.music_volume ?? 0.18}`,
  ].join("\n\n---\n\n");

  const baseline = await lint(projectDir);
  let lastNewFindings = [];
  let agentResult;
  // See run-agent.mjs's priorMessages doc + scene-writer.mjs's identical pattern —
  // carries the conversation across fix attempts so retries only send the new lint
  // findings, not skill + worked example + scene data again (~8.4k tokens/attempt).
  let priorMessages = null;
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const addUsage = (u) => {
    if (!u) return;
    usage.promptTokens += u.promptTokens ?? 0;
    usage.completionTokens += u.completionTokens ?? 0;
    usage.totalTokens += u.totalTokens ?? 0;
  };

  for (let attempt = 0; attempt <= maxFixAttempts; attempt++) {
    const userPrompt =
      attempt === 0
        ? basePrompt
        : `Lần viết trước (attempt ${attempt}) có lỗi lint MỚI (không tính lỗi có sẵn của project):\n${JSON.stringify(lastNewFindings, null, 2)}\n\nSửa lại đúng file index.html để hết các lỗi này. Không giải thích — sửa trực tiếp.`;

    try {
      agentResult = await runAgent({ systemPrompt, userPrompt, tools, model, maxTurns, onEvent, priorMessages });
    } catch (err) {
      addUsage(err.usage);
      err.usage = { ...usage };
      throw err;
    }
    priorMessages = agentResult.messages;
    addUsage(agentResult.usage);

    const current = await lint(projectDir);
    lastNewFindings = diffNewFindings(baseline, current);
    onEvent?.({ type: "lint", attempt, newFindingCount: lastNewFindings.length });

    if (lastNewFindings.length === 0) {
      const html = readFileSync(join(projectDir, "index.html"), "utf-8");
      const staticWarnings = checkPseudoElementAnimations(html);
      if (staticWarnings.length) onEvent?.({ type: "static-check", staticWarnings });
      return { ok: true, attempts: attempt + 1, agentResult, staticWarnings, usage };
    }
  }

  return { ok: false, attempts: maxFixAttempts + 1, newFindings: lastNewFindings, agentResult, usage };
}
