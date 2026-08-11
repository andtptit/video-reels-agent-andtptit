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
import { DEFAULT_SUB_STYLE, SUB_STYLES } from "../templates/sub-styles/index.mjs";

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
  // Which stock-photo search provider sub-scene-writer.mjs uses for subStyles with
  // `imageSource: "stock-photo"` (see IMAGE_SEARCH_PROVIDERS there) — "pexels" |
  // "openverse". Only meaningful/persisted when usesStockPhoto below is true; this
  // step never calls the provider itself, just records the choice for the scene step.
  photoProvider,
  model = DEFAULT_MODEL,
  maxTurns = 8,
  onEvent,
  signal,
}) {
  // "sub" template forces the ai-image prompt-writing path UNLESS the chosen
  // subStyle explicitly opts out (kinetic_typography — full-screen text, no
  // background image at all, see its own `needsImage = false` export). Checking
  // the registry here instead of hardcoding a style-id list means a future
  // no-image sub-style only needs the one `needsImage` export to also skip this.
  const subStyleNeedsImage = template !== "sub" || (SUB_STYLES[subStyle]?.needsImage ?? true);
  const effectiveVisualStyle = template === "sub" && subStyleNeedsImage ? "ai-image" : visualStyle;
  // "investigation_board" acquires its image via Pexels search (see
  // sub-scene-writer.mjs), not AI generation — even though effectiveVisualStyle above
  // still resolves to "ai-image" (it forces the "sub" template into requesting SOME
  // image), the per-scene fields the model must write are completely different
  // (a search keyword, not a generation prompt) — see stockPhotoOverride below.
  const usesStockPhoto = template === "sub" && SUB_STYLES[subStyle]?.imageSource === "stock-photo";
  const skill = readFileSync(SKILL_PATH, "utf-8");
  // DESIGN.md is a single file shared verbatim across every project (new-video.mjs
  // just copies it, never authored per-video) and its entire content is a CSS/GSAP
  // visual spec for template "motion" (colors, easing, atmosphere) — it carries no
  // actual per-video mood/content signal despite what the imageStyleOverride text
  // below used to claim. Confirmed live via user report: real image_prompts for a
  // "sub" project came back with "neon green"/"glowing steam" baked into the SUBJECT
  // description (checkImagePromptHygiene below caught it, but only as a passive
  // warning) — the model was pulling straight from this file's neon-dark palette
  // despite the explicit "don't" instruction. Only reading/sending it for "motion"
  // (the one template whose scene-writer.mjs LLM step actually needs it to author
  // matching CSS/GSAP) removes the leak at the source instead of just detecting it
  // after the fact.
  const hasDesign = template === "motion";
  const design = hasDesign ? readFileSync(join(projectDir, "DESIGN.md"), "utf-8") : null;
  const scenesWithTiming = readFileSync(join(projectDir, "scenes-with-timing.json"), "utf-8");
  const tools = createFsTools(projectDir);

  const stockPhotoOverride = usesStockPhoto
    ? `

---

Style video này dùng ẢNH THẬT lấy từ kho ảnh stock, KHÔNG sinh bằng AI — mỗi
scene cần 1 ảnh thật minh hoạ đúng nội dung (địa điểm, toà nhà, đồ vật, hiện trường liên
quan tới narration của scene đó). Với MỖI scene trong \`video-plan.json\`, thêm các
field sau:

- \`"photo_keyword"\`: từ khoá TÌM ảnh có sẵn (tiếng Anh, 2-5 từ, mô tả CHỦ THỂ CỤ THỂ
  — vd \`"office building exterior"\`, \`"stack of documents desk"\`, \`"handshake
  meeting room"\`) — đây là từ khoá TÌM, KHÔNG PHẢI prompt sinh ảnh — không mô tả phong
  cách/màu sắc, chỉ mô tả 1 ảnh CÓ THẬT nào cần tìm trên kho stock.
- \`"label_text"\`: 1 nhãn ngắn (dưới 4 từ, tiếng Việt, VIẾT HOA) gắn kèm ảnh — tên địa
  điểm/tổ chức/mốc thời gian được nhắc tới trong narration của scene đó (vd \`"TRỤ SỞ
  CÔNG TY"\`, \`"NĂM 2016"\`, \`"HỒ SƠ MẬT"\`). Nếu scene không có chi tiết nào phù hợp
  làm nhãn thì để chuỗi rỗng \`""\`.
- \`"show_evidence_link"\`: \`true\`/\`false\` — \`true\` nếu scene này nên có dây chỉ đỏ
  nối ảnh sang 1 chi tiết khác (dùng cho scene mang tính "liên kết bằng chứng/manh
  mối") — KHÔNG đặt \`true\` cho quá nửa số scene, phần lớn scene nên là \`false\`.
- \`"callouts"\`: mảng 0-2 phần tử, MỖI phần tử là \`{"text": "...", "style": "number"
  hoặc "tag"}\` — các con số/cụm từ NỔI BẬT nhất của scene, bay vào màn hình kèm hiệu
  ứng riêng (KHÁC với phụ đề chạy chữ ở đáy màn hình — phụ đề đáy vẫn hiện đầy đủ câu
  nói như bình thường, callout chỉ là điểm nhấn thêm, không thay thế phụ đề).
  - \`text\`: trích gần-nguyên-văn 1 con số hoặc cụm từ NGẮN (tối đa 4 từ) từ chính
    narration của scene đó — vd \`"11,5 triệu tài liệu"\`, \`"214.000 công ty"\`,
    \`"John Doe"\`. KHÔNG bịa số liệu không có trong narration.
  - \`style\`: \`"number"\` cho số liệu/thống kê (chữ to, màu vàng nổi bật), \`"tag"\`
    cho tên riêng/địa danh/mốc thời gian (chữ nhỏ hơn, màu trắng).
  - Không phải scene nào cũng cần callout — chỉ thêm khi scene THẬT SỰ có 1 con số/chi
    tiết đáng nhấn mạnh; để mảng rỗng \`[]\` nếu không có gì nổi bật đáng tách riêng.

KHÔNG thêm \`"image_prompt"\`/\`"image_tags"\` cho style này — chỉ dùng 4 field trên.`
    : "";

  const imageStyleOverride =
    effectiveVisualStyle === "ai-image" && !usesStockPhoto
      ? `

---

Style video này dùng ẢNH NỀN SINH BẰNG AI cho mỗi scene (không phải thuần CSS/GSAP).
Với MỖI scene trong \`video-plan.json\`, thêm field \`"image_prompt"\`: 1 câu mô tả ảnh
nền (tiếng Anh, để model sinh ảnh hiểu đúng) theo đúng các quy tắc sau:

- Phong cách ẢNH AI do DUY NHẤT cụm \`imageStylePrefix\` bên dưới quyết định.${
            hasDesign
              ? ` KHÔNG dùng màu sắc/mood/phong cách đọc từ DESIGN.md bên dưới cho \`image_prompt\` —
  DESIGN.md ở đây là bảng màu neon-xanh-tối mặc định của workspace cho style "motion"
  (CSS/GSAP thuần), HOÀN TOÀN KHÔNG áp dụng cho ảnh AI của style này, tuyệt đối không
  lấy màu sắc/ánh sáng (vd "neon", "glow", "dark background") từ DESIGN.md đưa vào
  \`image_prompt\`.`
              : ""
          }
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
  đổi, không tự diễn giải lại, không tự bịa cụm khác) — \`"${imageStylePrefix}"\` —
  chỉ phần trước đó (chủ thể/composition) mới đổi theo từng scene.
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

${hasDesign ? "DESIGN.md và scenes-with-timing.json đã" : "scenes-with-timing.json đã"} được nhúng đầy đủ
trong user message bên dưới — KHÔNG gọi \`read_file\` cho ${hasDesign ? "2 file này" : "file này"} nữa,
chỉ lãng phí turn.${imageStyleOverride}${stockPhotoOverride}`;

  const userPrompt = hasDesign
    ? `DESIGN.md:\n${design}\n\n---\n\nscenes-with-timing.json:\n${scenesWithTiming}`
    : `scenes-with-timing.json:\n${scenesWithTiming}`;

  // Heaviest single-call task in the pipeline (detailed visual_brief + elements +
  // sfx_picks per scene, often 8+ scenes) — confirmed live that the DashScope global
  // default (was 90s) wasn't enough: 3 separate real runs each burned the full 90s ×
  // 3 retries and still got AbortError, so the model was still generating, not stuck.
  // Give this one extra headroom beyond the (now-raised) global default.
  const result = await runAgent({ systemPrompt, userPrompt, tools, model, maxTurns, onEvent, timeoutMs: 240_000, signal });

  const outFile = join(projectDir, "video-plan.json");
  if (existsSync(outFile)) {
    const plan = JSON.parse(readFileSync(outFile, "utf-8"));
    const durationCheck = checkDurationSum({ total: plan.total_duration ?? 0, scenes: plan.scenes ?? [], key: "duration" });
    if (!durationCheck.ok) onEvent?.({ type: "duration-check", ...durationCheck });

    if (effectiveVisualStyle === "ai-image" && !usesStockPhoto) {
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
      if (usesStockPhoto) plan.photoProvider = photoProvider || "pexels";
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
