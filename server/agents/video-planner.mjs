/**
 * video-planner agent task — reuses .agents/skills/video-planner/SKILL.md verbatim.
 * Input: DESIGN.md + scenes-with-timing.json (both read directly and inlined into
 * the prompt — small, required, no reason to spend a tool-call round-trip on them).
 * Output: video-plan.json, written via the write_file tool.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { runAgent, DEFAULT_MODEL } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";
import { checkDurationSum, checkImagePromptHygiene } from "../tools/validators.mjs";
import { DEFAULT_SUB_STYLE } from "../templates/sub-styles/index.mjs";

const SKILL_PATH = join(import.meta.dirname, "..", "..", ".agents", "skills", "video-planner", "SKILL.md");

// Pixelle-Video's own default (pixelle_video/config/schema.py: `prompt_prefix`) —
// reused verbatim rather than inventing a new default, since the user explicitly
// asked for a "minimal" default and this is the exact wording an existing, working
// tool ships with.
const DEFAULT_IMAGE_STYLE_PREFIX =
  "Minimalist black-and-white matchstick figure style illustration, clean lines, simple sketch style";

// Fixed vocabulary for `image_tags` — deliberately a closed list, not free-form tags.
// The whole point (image-library.mjs reuse) is matching by tag OVERLAP across scenes/
// videos; free-form tags ("hand-holding" vs "holding-hands" vs "hands-touching") would
// almost never collide as exact strings, making overlap-matching useless. Covers
// common short-form narrative beats this workspace's content tends to reuse (romance/
// nostalgia niche so far, but broad enough for other emotional/motivational content).
const IMAGE_TAG_VOCAB = [
  "hands", "paper-note", "heart", "walking-together", "letter-writing", "crying",
  "hug", "clock-time", "sunset", "classroom", "phone", "umbrella-rain", "memory-flashback",
  "distance-longing", "smile-joy", "argument-conflict", "gift-giving", "photo-album",
  "night-stars", "door-window", "books-study", "bicycle", "coffee-cup", "flowers",
  "mirror-reflection", "suitcase-travel", "goodbye-farewell", "reunion", "family",
  "friendship", "success-achievement", "motivation-determination", "money-finance",
  "technology-ai", "nature-outdoor", "city-urban", "sleep-rest", "food-meal",
  "music-headphones", "sports-exercise", "question-thinking",
];

export async function runVideoPlanner({
  projectDir,
  // "animation" — thuần CSS/GSAP như hiện tại (mặc định, không đổi hành vi cũ).
  // "ai-image" — mỗi scene có thêm 1 ảnh nền sinh bằng AI (wan2.6-image), scene-writer
  // sẽ tải ảnh dựa trên field `image_prompt` mà bước này viết ra.
  visualStyle = "animation",
  // "motion" (default) — luồng hiện tại, scene-writer (LLM) viết layout/animation.
  // "sub" — luồng hoàn toàn tách biệt (sub-scene-writer.mjs, KHÔNG qua LLM cho bước
  // viết composition): ảnh AI nền full-bleed + sub karaoke từng chữ chạy theo
  // word_timestamps thật. Luôn cần ảnh AI nên ép visualStyle="ai-image" bên dưới bất
  // kể caller truyền gì — không để 2 tham số này lỡ mâu thuẫn nhau.
  template = "motion",
  subStyle = DEFAULT_SUB_STYLE,
  fontFamily, // caption font for template === "sub" — persisted into video-plan.json
  // (same reasoning as template/subStyle below) so every scene's generate call reads
  // the same value without the caller having to repeat it each time.
  cheapModel, // DashScope model id for scene-writer/root-composer (undefined = their
  // own CHEAP_MODEL default). Persisted below for the same reason as fontFamily —
  // every scene of one video should use the same model, not whatever the UI happened
  // to have selected when each individual "Generate" button was clicked.
  imageModel, // DashScope image model id for scene-writer/sub-scene-writer (undefined
  // = their own env-configured default). Persisted for the same reason.
  // Cụm mô tả phong cách CỐ ĐỊNH cho ảnh AI, áp dụng cho MỌI scene của video này.
  // Trước đây model phải TỰ NGHĨ RA 1 cụm và tự giữ nhất quán suốt các scene — đúng
  // kiểu lỗi đã gặp nhiều lần trong pipeline này (không tin LLM giữ đúng 1 giá trị
  // cấu trúc xuyên suốt). Giờ đưa thẳng cụm này vào prompt, model chỉ cần dùng lại
  // nguyên văn — không tự bịa, không tự đổi giữa các scene.
  imageStylePrefix = DEFAULT_IMAGE_STYLE_PREFIX,
  // Image-library reuse settings — see lib/image-library.mjs. `profileSlug` gates
  // reuse entirely: a video with no selected channel profile never reads from or
  // writes to the shared library (typed-by-hand image styles are one-off, not a
  // reusable "house style" — confirmed with user before building this). Persisted
  // into video-plan.json (same reasoning as fontFamily/cheapModel above) so every
  // scene's generate call sees the same settings without re-passing them.
  imageLibraryEnabled = false,
  imageLibraryMaxReuse = null,
  profileSlug = null,
  // Ken Burns zoom-out (1 -> 1.1) trên ảnh nền mỗi scene, chỉ áp dụng cho style
  // "sub" (ảnh full-bleed). Mặc định TẮT — user yêu cầu rõ đây là option chọn thêm,
  // không phải hành vi mặc định mới.
  kenBurns = false,
  // Film-grain/scratch overlay, static, độc lập với kenBurns — cùng lý do mặc định
  // TẮT như trên.
  grain = false,
  model = DEFAULT_MODEL,
  maxTurns = 8,
  onEvent,
}) {
  const effectiveVisualStyle = template === "sub" ? "ai-image" : visualStyle;
  const skill = readFileSync(SKILL_PATH, "utf-8");
  const design = readFileSync(join(projectDir, "DESIGN.md"), "utf-8");
  const scenesWithTiming = readFileSync(join(projectDir, "scenes-with-timing.json"), "utf-8");
  const tools = createFsTools(projectDir);

  const imageStyleOverride =
    effectiveVisualStyle === "ai-image"
      ? `

---

Style video này dùng ẢNH NỀN SINH BẰNG AI cho mỗi scene (không phải thuần CSS/GSAP).
Với MỖI scene trong \`video-plan.json\`, thêm field \`"image_prompt"\`: 1 câu mô tả ảnh
nền (tiếng Anh, để model sinh ảnh hiểu đúng) theo đúng các quy tắc sau:

- KHÔNG dùng màu sắc/mood/phong cách đọc từ DESIGN.md bên dưới cho \`image_prompt\` —
  DESIGN.md ở đây là bảng màu neon-xanh-tối mặc định của workspace cho style "motion"
  (CSS/GSAP thuần), HOÀN TOÀN KHÔNG áp dụng cho ảnh AI của style này. Phong cách ẢNH
  AI do DUY NHẤT cụm \`imageStylePrefix\` bên dưới quyết định — chỉ đọc DESIGN.md để
  hiểu MOOD/NỘI DUNG của video (phục vụ chọn chủ thể/composition từng scene), tuyệt
  đối không lấy màu sắc/ánh sáng (vd "neon", "glow", "dark background") từ đó đưa vào
  \`image_prompt\`.
- Chỉ mô tả CHỦ THỂ THỊ GIÁC THUẦN TUÝ (đồ vật, khung cảnh, biểu tượng, con người,
  bố cục minh hoạ) — TUYỆT ĐỐI KHÔNG mô tả ảnh có chứa chữ/từ/câu dưới bất kỳ hình
  thức nào, kể cả đặt trong ngoặc kép (vd KHÔNG viết "text saying '...'", "glowing
  text '...'", "words reading '...'", "caption '...'") — dù mục đích là minh hoạ nội
  dung, ảnh sinh ra sẽ cố vẽ chữ thật và luôn ra ký tự méo/lỗi (kể cả lẫn ký tự không
  phải latin). Phụ đề/text đã có HTML overlay lo hoàn toàn, ảnh AI KHÔNG BAO GIỜ được
  chứa chữ dưới bất kỳ hình thức nào.
- DANH SÁCH TỪ CẤM (không dùng trong phần chủ thể của prompt, dưới mọi hình thức,
  kể cả biến thể/đồng nghĩa) — vì mỗi từ này luôn kéo theo mô tả 1 vật thể có chữ hoặc
  màu sắc tối/neon không thuộc \`imageStylePrefix\`: \`text\`, \`word\`/\`words\`,
  \`caption\`, \`quote\`, \`headline\`, \`subhead\`/\`subheading\`, \`title card\`,
  \`neon\`, \`glow\`/\`glowing\`, \`dark background\`, \`tech aesthetic\`. Nếu ý định
  ban đầu là "chữ nổi bật giữa màn hình" hay "tiêu đề" thì đổi hẳn sang mô tả 1 VẬT
  THỂ minh hoạ ý nghĩa đó thay vì mô tả chữ (vd thay vì "bold headline in center" hãy
  mô tả 1 hình minh hoạ/biểu tượng thể hiện đúng ý nghĩa câu đó).
- TUYỆT ĐỐI không có chữ/số/watermark trong ảnh (\`"no text, no words, no watermark"\`
  luôn có ở cuối mỗi prompt) — chữ thật sẽ do HTML overlay lên trên.
- Chừa khoảng trống thị giác (negative space) ở giữa hoặc 1 phía cho text overlay đọc
  được — nói rõ trong prompt (vd \`"empty center for text overlay"\`).
- BẮT BUỘC kết thúc MỌI prompt của video này bằng ĐÚNG NGUYÊN VĂN cụm sau (không tự
  đổi, không tự diễn giải lại, không tự bịa cụm khác dù DESIGN.md nói gì) —
  \`"${imageStylePrefix}"\` — chỉ phần trước đó (chủ thể/composition) mới đổi theo từng scene.
- 1 câu, súc tích, không quá 300 ký tự.

Với MỖI scene, thêm CẢ field \`"image_tags"\`: mảng 2-4 tag mô tả Ý NGHĨA hình ảnh của
scene đó (không phải mô tả chi tiết ảnh) — dùng để nhận diện scene có thể TÁI DÙNG ảnh
đã sinh từ video khác hay không. BẮT BUỘC chỉ chọn tag từ đúng danh sách sau (không tự
bịa tag mới, không đổi cách viết) — chọn tag GẦN NGHĨA NHẤT dù không khớp 100%:
${IMAGE_TAG_VOCAB.join(", ")}`
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

    if (effectiveVisualStyle === "ai-image") {
      const promptCheck = checkImagePromptHygiene(plan.scenes ?? []);
      if (!promptCheck.ok) onEvent?.({ type: "image-prompt-hygiene", ...promptCheck });
    }

    // Written by CODE, not the model — routes.mjs's scene-generate route trusts
    // `plan.template` to decide scene-writer (LLM) vs sub-scene-writer (deterministic)
    // per scene, and every past pipeline bug traced back to trusting the model to
    // echo a structural value correctly instead of the caller just setting it.
    plan.template = template;
    if (template === "sub") {
      plan.subStyle = subStyle;
      if (fontFamily) plan.fontFamily = fontFamily;
      plan.kenBurns = Boolean(kenBurns);
      plan.grain = Boolean(grain);
    }
    if (cheapModel) plan.cheapModel = cheapModel;
    if (imageModel) plan.imageModel = imageModel;
    plan.imageLibrary = {
      enabled: Boolean(imageLibraryEnabled && profileSlug),
      maxReuse: imageLibraryMaxReuse ?? null,
      profileSlug: profileSlug || null,
    };
    writeFileSync(outFile, JSON.stringify(plan, null, 2));

    return { ...result, durationCheck };
  }

  return result;
}
