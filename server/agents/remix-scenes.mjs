/**
 * "Remix" agent — for style="sub" projects only. Rewrites narration (style/tone/
 * target-audience) while keeping the exact same sceneId list, order, and visual
 * meaning, so the already-generated AI images (the expensive part of a "sub" video)
 * stay valid and never need regenerating. See plan.md for the cost reasoning: the
 * whole feature exists because re-running content-planner + video-planner from
 * scratch would also regenerate `image_prompt` per scene, and even though
 * generateAndSaveImage's skip-if-exists check is keyed by sceneId (not prompt text,
 * so it would still skip physically), a fresh video-plan.json would carry
 * image_prompt text that no longer matches the actual reused image — this agent
 * avoids touching video-plan.json/image_prompt at all, only ever writes scenes.json.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { runAgent, DEFAULT_MODEL } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";

/**
 * @param {object} params
 * @param {string} params.projectDir - the NEW (remix) project dir — scenes.json gets
 *   written here, not into the source project.
 * @param {object[]} params.sourceScenes - `scenes-with-timing.json.scenes` from the
 *   ORIGINAL project (sceneId/narration/meaning/mood_hint/is_hook/estimated_duration).
 * @param {string} params.remixPrompt - free-text remix instruction from the user
 *   (change writing style, target audience, tone, etc).
 */
export async function runRemixScenes({ projectDir, sourceScenes, remixPrompt, model = DEFAULT_MODEL, onEvent, signal }) {
  const tools = createFsTools(projectDir);

  // Strip `_audio` (stale mp3 path/word-timestamps from the OLD narration — audio
  // gets regenerated fresh for the new narration, these numbers are meaningless
  // here) and any visual/image fields (untouched by this step; video-plan.json
  // already has the real image_prompt, copied over unchanged by the caller).
  const sourceForPrompt = (sourceScenes ?? []).map((s) => ({
    sceneId: s.sceneId,
    narration: s.narration,
    meaning: s.meaning,
    mood_hint: s.mood_hint,
    is_hook: s.is_hook,
    estimated_duration: s._audio?.vo_duration ?? s.estimated_duration,
  }));

  const systemPrompt = `Bạn đang REMIX lại narration của 1 video đã có sẵn ảnh AI cho
từng scene — video này SẼ KHÔNG sinh ảnh mới, ảnh cũ được tái sử dụng nguyên vẹn theo
đúng \`sceneId\`. Vì vậy:

- TUYỆT ĐỐI giữ nguyên số lượng scene, đúng thứ tự, và đúng \`sceneId\`/\`mood_hint\`/
  \`is_hook\` của bản gốc — không thêm/bớt/đổi tên scene nào.
- Chỉ viết lại \`narration\` (và \`meaning\` nếu cần khớp narration mới) theo ĐÚNG yêu
  cầu remix của user bên dưới.
- Narration mới KHÔNG được đổi ý nghĩa hình ảnh cốt lõi của từng scene quá xa so với
  bản gốc — ảnh nền đã cố định sẵn, câu chữ mới vẫn phải hợp lý khi đặt lên đúng ảnh đó
  (ví dụ: scene gốc mô tả "2 người đi chung một đoạn đường" thì narration mới dù đổi
  văn phong/đối tượng vẫn nên nói về cùng hình ảnh/hành động đó, không lái sang chủ đề
  khác hẳn).
- \`estimated_duration\` ước tính lại theo độ dài narration MỚI (không copy số cũ).

Bạn đang chạy tự động (non-interactive). Dùng tool \`write_file\` để lưu đúng 1 file vào
project root (path tương đối, không tiền tố project): \`scenes.json\`, đúng format:
\`\`\`json
{
  "total_estimated_duration": <tổng số giây ước tính>,
  "scenes": [
    { "sceneId": "...", "narration": "...", "meaning": "...", "estimated_duration": <số>, "mood_hint": "...", "is_hook": true|false },
    ...
  ]
}
\`\`\`
Sau khi ghi xong, trả lời bằng 1 câu tóm tắt ngắn — không tool call nào nữa.`;

  const userPrompt = [
    `Yêu cầu remix: ${remixPrompt}`,
    `Scene gốc (KHÔNG đổi sceneId/thứ tự/số lượng):\n${JSON.stringify(sourceForPrompt, null, 2)}`,
  ].join("\n\n---\n\n");

  const result = await runAgent({ systemPrompt, userPrompt, tools, model, onEvent, signal });

  const outFile = join(projectDir, "scenes.json");
  if (existsSync(outFile)) {
    const scenes = JSON.parse(readFileSync(outFile, "utf-8"));
    const gotIds = (scenes.scenes ?? []).map((s) => s.sceneId).sort();
    const wantIds = sourceForPrompt.map((s) => s.sceneId).sort();
    const mismatched = JSON.stringify(gotIds) !== JSON.stringify(wantIds);
    if (mismatched) {
      onEvent?.({ type: "scene-id-mismatch", got: gotIds, want: wantIds });
      const err = new Error(
        `Remix đổi sai danh sách scene — cần đúng [${wantIds.join(", ")}], nhận được [${gotIds.join(", ")}]. Ảnh AI cũ chỉ khớp đúng sceneId gốc.`
      );
      err.usage = result.usage;
      throw err;
    }
  }

  return result;
}
