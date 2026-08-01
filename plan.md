# Plan: Web UI fallback (DashScope + Edge TTS) khi hết credit Claude

## Bối cảnh — vì sao có nhánh việc này

Repo gốc chạy pipeline hoàn toàn qua Claude Code (xem `CLAUDE.md`). User muốn **giữ
nguyên workflow Claude Code làm chính**, nhưng cần thêm một backend/agent chạy bằng
model rẻ hơn để dùng **khi hết credit Claude** — mục tiêu là tiết kiệm chi phí, không
thay thế Claude Code. Đã chốt trong phiên làm việc trước:

- LLM mặc định cho nhánh này: **DashScope (Qwen)**, gọi qua endpoint OpenAI-compatible
  quốc tế (`https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions`)
- TTS mặc định: **Edge TTS** (free, không cần key) — vì tài khoản ElevenLabs hiện tại
  là Free plan, bị chặn cả TTS-qua-API (402 `paid_plan_required` — free user không
  dùng được library voice qua API) lẫn Sound Generation (401 `missing_permissions`)
  khi test trực tiếp
- MVP scope: core loop (content-planner → audio → video-planner → scene-writer) +
  sau này thêm 1 nguồn ảnh AI (DashScope image-gen) — **chưa làm tới phần ảnh**
- Rủi ro lớn nhất cần de-risk trước: chất lượng DashScope khi chạy tự động
  (non-interactive agent loop) theo đúng các SKILL.md hiện có — **đã kiểm chứng, kết
  quả tốt**, xem phần "Đã làm" bên dưới.

Kế hoạch gốc (5 phase) được duyệt và lưu tại
`C:\Users\toila\.claude\plans\stateless-jingling-abelson.md` (máy local của user, không
nằm trong repo). File `plan.md` này là bản cập nhật tình trạng thực tế + việc còn lại,
dùng để phiên làm việc sau đọc và tiếp tục — không cần đọc file plan gốc kia nữa.

---

## Đã làm — Phase 0 (Foundations) ✅ xong, đã test

| File | Vai trò |
|---|---|
| `server/package.json` | Deps riêng cho backend (hiện chỉ có `msedge-tts`) |
| `server/providers/tts/elevenlabs.mjs` | Logic TTS ElevenLabs tách ra từ `generate-audio.mjs` gốc — cùng behavior cũ |
| `server/providers/tts/edge-tts.mjs` | Provider TTS free qua `msedge-tts`, parse `WordBoundary` metadata → shape `{word, start, end}` giống hệt ElevenLabs |
| `scripts/generate-audio.mjs` | Sửa để chọn provider qua env `TTS_PROVIDER` (`elevenlabs` mặc định | `edge-tts`) — downstream (timing math, SFX/music copy) không đổi |
| `server/tools/hyperframes-cli.mjs` | Wrapper `lint/validate/render` qua `--json`, xử lý riêng việc gọi `npx` trên Windows (xem "Bug đã vá" bên dưới) |
| `.env.example` | Thêm mới ở root — trước đây không có |

**Đã test thật**: Edge TTS sinh mp3 tiếng Việt hợp lệ (`vi-VN-HoaiMyNeural`, 24kHz mono)
+ word-timestamp đúng giây, không cần key nào. ElevenLabs path không đổi hành vi.

---

## Đã làm — Phase 1 (Agent core DashScope) ✅ xong, đã test end-to-end

| File | Vai trò |
|---|---|
| `server/providers/llm/dashscope.mjs` | Gọi chat completion DashScope, có timeout 90s + retry 2 lần (backoff) |
| `server/tools/fs-tools.mjs` | Tool `read_file`/`write_file`/`list_dir` sandbox theo project dir, chặn path traversal |
| `server/agents/run-agent.mjs` | Vòng lặp agent chung: gọi model → nếu có `tool_calls` thì chạy qua `executors` → lặp tới khi model dừng hoặc hết `maxTurns` |
| `server/agents/content-planner.mjs` | Dùng nguyên văn `.agents/skills/content-planner/SKILL.md` làm system prompt + override "không hỏi lại, dùng thông tin cho sẵn" (vì chạy non-interactive) |
| `server/agents/video-planner.mjs` | Dùng nguyên văn `.agents/skills/video-planner/SKILL.md`; đọc `DESIGN.md` + `scenes-with-timing.json` trực tiếp rồi nhúng vào prompt (không tốn turn gọi tool) |
| `server/agents/scene-writer.mjs` | Dùng nguyên văn `.agents/skills/hyperframes/SKILL.md` + override riêng của project (selector `#scene-NN`, class prefix `.sN-`, `repeat: Math.ceil` không bao giờ `-1`). Có **validation gate**: lint baseline trước khi viết, sau đó tối đa 3 lần tự sửa, chỉ đưa model xem lỗi lint MỚI (diff so với baseline) để tránh bị chặn bởi lỗi có sẵn không liên quan |
| `server/agents/test-content-planner.mjs` | CLI test độc lập: `node --env-file=.env server/agents/test-content-planner.mjs "<idea>" <projectDir>` |
| `server/agents/test-video-planner.mjs` | CLI test độc lập: `node --env-file=.env server/agents/test-video-planner.mjs <projectDir>` |
| `server/agents/test-scene-writer.mjs` | CLI test độc lập: `node --env-file=.env server/agents/test-scene-writer.mjs <projectDir> <sceneId>` |

### Kết quả test thật (chủ đề so sánh: "Claude Code biến ý tưởng thành phần mềm bán được" — cùng chủ đề một project Claude đã viết trước đó)

- **content-planner**: 3 turn, viết `master_content.md` + `scenes.json`. Bám sát checklist
  của skill: `narration` trích nguyên văn, đúng cấu trúc Hook→Pain→Bridge→Value→Proof→CTA,
  số liệu cụ thể. Nit nhỏ: `total_estimated_duration` đôi khi không khớp tổng các scene
  (field này skill ghi rõ "chỉ để tham khảo" nên không nghiêm trọng).
- **video-planner**: 4 turn (có 2 lần gọi `read_file` thừa dù nội dung đã nhúng sẵn trong
  prompt — lãng phí nhẹ, không sai). Chọn đúng `content_shape` theo đúng catalogue của
  skill (two-column/spotlight/checklist/big-number/cta, không trùng 2 scene liên tiếp),
  dùng đúng hex/font từ `DESIGN.md`, đủ 5 phần `visual_brief`.
- **scene-writer**: PASS lint (0 errors, 0 warnings) sau 2 attempt (vòng tự sửa bắt và
  fix đúng 2 lỗi lint mới ở bản nháp đầu). Review tay file HTML: đúng hết convention bắt
  buộc (selector, class prefix, `class="clip"`, đăng ký timeline, toán
  `data-duration = scene_duration - data-start` chính xác tuyệt đối, chỉ có entrance
  animation đúng luật). **1 lỗi ngữ nghĩa lint không bắt được**: agent viết
  `tl.to("#scene-01::after", {...})` để pulse glow — GSAP không animate được pseudo-element
  qua cách này nên hiệu ứng đó âm thầm không chạy (không crash, không lỗi lint). Đây là
  bằng chứng cụ thể cho giới hạn đã cảnh báo trước: lint/validate chỉ bắt lỗi cấu
  trúc/timing, không bắt lỗi ngữ nghĩa animation.

### Bug hạ tầng đã phát hiện + vá trong lúc test (không phải giả định — lỗi thật)

1. **`dashscope.mjs` crash cả process khi API chậm** — không có timeout, một lần
   DashScope phản hồi chậm gây `HeadersTimeoutError` không bắt được, kill toàn bộ
   Node process giữa vòng tự sửa lint. Đã vá: `AbortController` timeout 90s + retry
   2 lần có backoff (1s, 2s).
2. **`hyperframes-cli.mjs` gọi `npx` qua `shell:true` trên Windows bị `ENOENT`** — vì
   `shell:true` cần biến môi trường `%ComSpec%`/PATH chuẩn Windows, nhưng shell Git-Bash
   dùng trong phiên này không có các biến đó. Đã vá: tự dò đường dẫn `cmd.exe` (thử
   `ComSpec` → `SystemRoot` → `windir` → fallback cứng `C:\Windows\System32\cmd.exe`)
   và gọi trực tiếp `cmd.exe /d /s /c npx ...`, bỏ hẳn `shell:true` (cũng hết luôn
   deprecation warning của Node về việc không escape args qua shell).

---

## Credentials hiện có trong `.env` (local, đã gitignore)

- `ELEVENLABS_API_KEY` — đã set, nhưng tài khoản là **Free plan**: TTS qua API bị
  chặn (402 `paid_plan_required` — free user không dùng được library voice qua API),
  Sound Generation cũng bị chặn (401 `missing_permissions`). Cần nâng cấp gói hoặc tự
  tạo/clone voice riêng (xem thảo luận trước) mới dùng lại được ElevenLabs.
- `DASHSCOPE_API_KEY` — đã set và **xác nhận hoạt động** (test cả chat completion lẫn
  tool-calling thành công qua `qwen-turbo`/`qwen-plus`, endpoint quốc tế).
- `TTS_PROVIDER` — mặc định `elevenlabs` trong `.env.example`. **Khuyến nghị đổi sang
  `edge-tts`** trong `.env` thật cho tới khi ElevenLabs được nâng cấp/có voice riêng.
- `EDGE_TTS_VOICE=vi-VN-HoaiMyNeural` — giọng nữ tiếng Việt mặc định cho Edge TTS.

---

## Đã làm — Root-composer (phát sinh ngoài kế hoạch gốc, phiên 2026-07-31)

### Bối cảnh phát hiện

Test UI thật (user tự tay generate content-planner → audio → video-planner → scene
→ render qua giao diện) lộ ra 2 vấn đề:

1. **Render "thành công" nhưng ra video đen 10 giây** — kiểm tra `index.html` gốc của
   project mới thấy vẫn là scaffold trống nguyên bản từ `hyperframes init` (`<div
   id="root" ... data-duration="10">` rỗng, comment "Add your clips here" chưa bị
   xoá). Nguyên nhân: **CLAUDE.md bước 6 "Viết root index.html"** (ghép atmosphere +
   nhạc + voiceover + các scene sub-composition vào timeline gốc, có crossfade) chưa
   từng được tự động hoá ở Phase 1–3 — pipeline cũ chỉ tự động bước 1→5 (content →
   audio → video-plan → viết TỪNG scene riêng lẻ), còn bước ghép lại vào timeline gốc
   vẫn là việc thủ công (làm qua Claude Code + `/hyperframes`).
2. **Một số scene báo lỗi trong job-status nhưng vẫn hiện trong preview** — do panel
   Preview (HyperFrames Studio) liệt kê MỌI file có trong `compositions/` trên đĩa,
   không quan tâm `job-status.json` ghi thành công hay lỗi (file HTML vẫn được ghi ở
   lần thử cuối dù lint không pass). Không phải bug, chỉ là 2 nguồn thông tin độc lập
   — nhưng dễ gây hiểu nhầm. Đồng thời phát hiện tài khoản DashScope của user đã hết
   free quota (`403 AllocationQuota.FreeTierOnly`) giữa lúc test — không phải bug,
   là giới hạn tài khoản, nhưng giải thích phần lớn "lỗi" quan sát được lúc đó.

Quyết định: xây agent mới tự động hoá bước 6 (thay vì để user tự làm thủ công).

### Đã làm

| File | Vai trò |
|---|---|
| `server/agents/root-composer.mjs` | Agent mới, cùng pattern validation-gate với `scene-writer.mjs` (baseline lint → tối đa 3 lần tự sửa dựa trên finding mới). Dùng nguyên văn `.agents/skills/hyperframes/SKILL.md` + override riêng cho ROOT composition: atmosphere track 0–6, nhạc track 20, voiceover track 21 (data-start = đúng data-start của scene, KHÔNG dùng thẳng field `voiceover_start` vì field đó chưa tính crossfade), scene clip track 10/11 xen kẽ, crossfade 0.3s + `tl.set` hard-kill. Prompt có kèm 1 ví dụ thật (rút từ `output/2026-05-16/huong-dan-cau-hinh-.../video/index.html` — project do người dùng Claude Code viết đúng trước đây) để model bám theo cấu trúc cụ thể thay vì chỉ mô tả bằng lời. **Chỉ ghép đúng danh sách scene đã generate thành công** — caller lọc trước theo `job-status.json`, agent không tự quyết định |
| `server/agents/test-root-composer.mjs` | CLI test độc lập, cùng convention `test-scene-writer.mjs` |
| `server/routes.mjs` — `POST /projects/:id/root` | Đọc `job-status.json`, lọc `doneSceneIds` = các `scene:<id>` có status `done`, 400 nếu chưa có scene nào xong hoặc thiếu `scenes-with-timing.json`/`DESIGN.md`, chạy qua `queues.dashscope` như các bước khác |
| `server/routes.mjs` — sửa `READABLE_FILES` | Đổi từ `Set` sang map `{filename: content-type}` — phát hiện bug tiềm ẩn khi thêm `index.html` vào whitelist: logic cũ đoán content-type theo đuôi file (`.md` → markdown, còn lại → `application/json`), nếu giữ nguyên thì `index.html` (không phải JSON) sẽ bị gắn nhầm `application/json`, khiến `web/src/api.js` gọi `res.json()` trên nội dung HTML và crash. Sửa trước khi kịp xảy ra |
| `web/src/api.js`, `web/src/components/Pipeline.jsx` | Thêm `api.runRoot()`, step "4. Ghép video (root)" giữa scene grid và Render — hiện số scene đã done, disable nút nếu chưa có scene nào xong; **Render bị khoá cho tới khi bước Ghép video xong** (trước đây chỉ cần video-plan done là bấm Render được — đúng nguồn gốc gây video đen) |

### Việc phụ làm trong lúc này (theo yêu cầu user)

- **Model chọn được qua `.env`**: thêm `export const DEFAULT_MODEL = process.env.DASHSCOPE_MODEL || "qwen-plus"` trong `run-agent.mjs`, cả 4 agent (content-planner, video-planner, scene-writer, root-composer) đều default theo hằng số này thay vì hard-code `"qwen-plus"` riêng lẻ. Muốn đổi model (vd `qwen3.6-plus`) chỉ cần thêm `DASHSCOPE_MODEL=qwen3.6-plus` vào `.env` thật rồi restart server — không cần sửa code.
- `.env.example` trước đây thiếu hẳn `DASHSCOPE_API_KEY` (dù bắt buộc cho mọi agent) — đã bổ sung, kèm `DASHSCOPE_MODEL`.

### Đã test — nhưng CHƯA test được chất lượng agent thật (quota hết)

Vì tài khoản DashScope hết free quota ngay trong lúc user test UI, root-composer
**chưa gọi LLM thật thành công lần nào**. Đã test được phần cơ chế (route/queue/lint
baseline/job-status) bằng cách gọi route thật trên project `ai-trong-marketing` (có
sẵn `scene_01`, `scene_05` done từ lúc trước) và quan sát lỗi quota thật lan đúng
tới `job-status.json`:

- Route lọc đúng `doneSceneIds = ["scene_01", "scene_05"]`, bỏ qua scene lỗi
- `queues.dashscope.run()` nhận job, `runRootComposer` chạy `lint()` baseline thành
  công (không lỗi ở bước này — nghĩa là code trước điểm gọi LLM đúng)
- Lỗi 403 quota từ DashScope lan đúng thành `job-status.steps.root = {status:"error",
  error: "...AllocationQuota.FreeTierOnly..."}` — xác nhận lại bug #4 đã vá ở Phase 2
  (job thất bại phải hiện đúng "error") vẫn hoạt động đúng cho step mới này
- 400 đúng khi thiếu `scenes-with-timing.json` (test trên project khác không có file
  này) và khi chưa có scene nào done
- `npx vite build` ở `web/` chạy sạch, không lỗi — xác nhận code frontend hợp lệ dù
  chưa click-test được toàn bộ luồng mới qua trình duyệt (vì cũng cần LLM thật để tới
  được bước 4)

**Việc còn nợ — quan trọng nhất trước khi tin dùng root-composer**: chạy lại toàn bộ
qua UI thật (bấm "Ghép video") SAU KHI user nạp quota DashScope hoặc chuyển model, để
xác nhận: (1) agent viết đúng cấu trúc root composition theo ví dụ đã cho, (2) lint
pass, (3) `hyperframes render` ra video thật có hình/tiếng thay vì đen — đây mới là
phép thử cuối cùng chứng minh cả 2 vấn đề gốc đã được giải quyết triệt để.

### Bug thật phát hiện + vá ngay sau đó: `maxTurns` bị vượt ở root-composer

User tự tay bấm "Ghép video" trên project `ai-trong-marketing` (sau khi restart server
— job-status trên đĩa không mất, chỉ cần server sống lại để SSE đọc được) và gặp lỗi
thật: `Agent exceeded maxTurns (8) without finishing`. Đọc lại `events` trong
`job-status.json` (log đầy đủ turn-by-turn, có sẵn từ thiết kế Phase 2) thấy rõ nguyên
nhân: agent tốn **6/8 turn chỉ để `read_file`/`list_dir` lại** `index.html`,
`compositions/scene_01/02/05.html`, `assets/audio`, `assets/music`, `hyperframes.json`
— dù toàn bộ dữ liệu này đã nhúng sẵn trong prompt. Chỉ còn 2 turn để viết file, không
đủ để hoàn tất. Đây là đúng bug đã biết ở `video-planner.mjs` (đã vá từ trước) nhưng
quên áp dụng cho `root-composer.mjs` mới. Đã vá:
- Thêm dòng cấm `read_file`/`list_dir` + giải thích `data-composition-id` theo quy ước
  cố định (không cần đọc lại để xác nhận) vào system prompt
- Nâng `maxTurns` từ 8 → 12 làm biên an toàn

### Tối ưu chi phí: giữ hội thoại qua các vòng tự-sửa lint (theo yêu cầu user)

User đặt câu hỏi hợp lý: pipeline DashScope có thể tốn token **hơn** cả việc để Claude
Code làm trực tiếp, vì mỗi agent nhúng nguyên văn skill (`hyperframes/SKILL.md` ~7.600
token, đo thật bằng `wc -c`) vào system prompt, và **mỗi lần retry lint lại gửi lại
system prompt đầy đủ** (vòng tự-sửa restart hội thoại mới hoàn toàn mỗi lần thay vì
tiếp tục). Đã sửa tại gốc:

- `run-agent.mjs` — `runAgent()` nhận thêm `priorMessages` (mảng messages cũ). Nếu có,
  BỎ QUA việc dựng lại system+user message mới, chỉ nối thêm 1 user message (chỉ thị
  sửa lỗi) vào cuối hội thoại cũ. Trả về `messages` cuối cùng trong kết quả để caller
  truyền tiếp cho attempt sau.
- `scene-writer.mjs` và `root-composer.mjs` — vòng lặp retry giờ giữ `priorMessages`
  qua các attempt; từ attempt thứ 2 trở đi, `userPrompt` CHỈ còn phần lỗi lint mới +
  chỉ thị sửa (không lặp lại `basePrompt` — skill, DESIGN.md, dữ liệu scene — vì đã có
  trong lịch sử hội thoại).

**Đã test bằng mock `fetch`** (không tốn quota DashScope thật) — giả lập 2 lần gọi
`runAgent`, lần 2 truyền `priorMessages` từ lần 1: xác nhận payload gửi đi ở lần 2 có
đúng 1 system message (không nhân đôi), text skill và text prompt gốc mỗi thứ xuất
hiện đúng 1 lần (không bị gửi lại) trong toàn bộ payload.

**Giới hạn đã nói rõ với user**: tối ưu này chỉ cắt phần lãng phí ở vòng retry TRONG
CÙNG 1 scene/root (điển hình tiết kiệm ~50% nếu 2 attempt, ~75% nếu 4 attempt — tính
từ số liệu thật đo được: skill+override ~7.8k token/lần cho scene-writer, ~8.4k cho
root-composer). KHÔNG giảm được chi phí giữa các scene khác nhau (mỗi scene vẫn là 1
task độc lập, phải gửi skill đầy đủ ít nhất 1 lần).

---

### Phase 4 — Tích hợp ảnh AI (chưa bắt đầu)
- `server/providers/image/dashscope-image.mjs` — DashScope image-gen (Tongyi
  Wanxiang/Qwen-Image), cố định style-prompt suffix (line-art/stick-figure) để nhất
  quán qua các scene
- `video-planner` cần thêm field `image_prompts` per scene khi style = "ảnh AI"
- `scene-writer` cần chèn `<img>` với `data-start/data-duration/data-track-index` theo
  đúng convention media hiện có

---

## Đã sửa — `root-composer` không nhận `format`, render ra video sai hướng (phiên 2026-08-01)

User báo qua ảnh chụp thật (project `model-kimi-ra-doi-khien-claude-de-chung`, tạo bằng
Web UI): (1) chữ dính vào nhau, nội dung dồn hết lên góc trên; (2) đã chọn 9:16 dọc lúc
tạo project nhưng video render ra **ngang**.

### Root cause #2 (đã xác nhận + sửa) — đúng 1 bug giải thích được cả 2 hiện tượng lúc đầu

`root-composer.mjs` chưa từng nhận `format` — khác `scene-writer.mjs` đã được vá từ
trước (xem mục "canvas dimension mismatch" phía trên), nhưng **quên áp dụng tương tự
cho root-composer**. Kiểm tra trực tiếp file thật: `video-plan.json` ghi `format:"9:16"`,
nhưng root `index.html` bị ghi `data-width="1920" data-height="1080"` (ngang) — cả ở
`<div id="root">` LẪN mọi scene-host `data-composition-src=...`, trong khi từng file
`compositions/scene_0N.html` (do `scene-writer` viết, đã có `format` từ trước) lại đúng
`1080×1920`. `ffprobe` xác nhận render ra đúng `1920×1080` — khớp bug báo cáo.

**Đã sửa**:
- `server/lib/canvas.mjs`'s `dimensionsForFormat()` giờ dùng chung cho `root-composer.mjs`
  (trước đó chỉ `scene-writer.mjs` dùng).
- `root-composer.mjs` nhận thêm param `format`, thêm dòng bắt buộc vào system prompt
  (dùng đúng số cho MỌI `data-width`/`data-height` trong file — root lẫn từng scene host,
  không lấy số từ `WORKED_EXAMPLE`).
- `server/tools/validators.mjs` thêm `checkAllCanvasDimensions()` — khác
  `checkCanvasDimensions()` (chỉ check occurrence ĐẦU TIÊN, đúng cho 1 file scene) ở chỗ
  quét TẤT CẢ occurrence trong `index.html` (root + N scene host), vì root có nhiều
  `data-width`/`data-height` cùng lúc. Nối vào cùng retry gate với lint (hard-fail, không
  chỉ warning).
- `routes.mjs` (`POST /projects/:id/root`) đọc thêm `video-plan.json` để lấy `format`,
  truyền vào `runRootComposer`. `test-root-composer.mjs` cũng cập nhật tương tự.

**Đã test lại thật trên đúng project bị lỗi**: chạy lại `test-root-composer.mjs` →
PASS 2 attempt, 94.495 token → `grep data-width/data-height index.html` xác nhận toàn bộ
6 chỗ (root + 5 scene) đều đúng `1080×1920` → render lại → `ffprobe` xác nhận **1080×1920
thật** (trước đó 1920×1080) → trích frame xác nhận không còn tràn ngang.

### Bug #1 (chữ dính, dồn góc trên) — ĐÃ CHẨN ĐOÁN CHÍNH XÁC, CHƯA TÌM RA NGUYÊN NHÂN THẬT

Sau khi sửa xong bug #2 (video đã đúng hướng), render lại vẫn còn nguyên bug #1 — xác
nhận đây là **2 bug độc lập**, không phải cùng 1 nguồn.

Dùng đúng công cụ chẩn đoán (`hyperframes inspect --json --at 3`, chưa từng dùng tới
trước phiên này) thay vì đoán mò: xác nhận chính xác `#el-title_kimi` nằm ở
`rect{top:-14, bottom:154}` bên trong `containerRect` ĐÃ ĐÚNG `{0,0,1080,1920}` — tức
khung canvas đúng, nhưng nội dung bên trong co lại thành khối ~150px cao rồi nằm sát đỉnh
thay vì `.s1-content{height:100%; justify-content:center}` phải canh giữa khối đó trong
suốt 1920px.

**5 giả thuyết đã test thật (mỗi lần đều `inspect`/render lại thật, không đoán suông),
CẢ 5 ĐỀU KHÔNG ĐỔI GÌ** — tự nó là dữ liệu quan trọng (loại trừ được rất nhiều hướng):
1. `html,body{width:1080px;height:1920px}` (thiếu so với bản Claude tự viết) — không đổi
2. `#scene-01{width:100%;height:100%}` tường minh — không đổi
3. `#scene-01{width:1080px;height:1920px}` (px tuyệt đối, loại trừ % ambiguity) — không đổi
4. Thêm `data-start="0"` còn thiếu trên root sub-composition — không đổi
5. Đổi hẳn nội dung chữ (`KIMI`→`CACHETEST999`) — **CÓ đổi** (chứng minh KHÔNG PHẢI do
   cache, `inspect`/`render` đọc file fresh mỗi lần) nhưng vị trí top/bottom vẫn y hệt
6. Đổi `font-size` 140px→40px — **CÓ đổi kích thước box** (48px thay vì 168px, đúng theo
   line-height) nhưng vẫn neo sát đỉnh (`top:-4` thay vì `top:-14`) — chứng minh CSS của
   `.s1-title` tự nó có được áp dụng, chỉ riêng phần CANH GIỮA THEO CHIỀU DỌC của
   `.s1-content` là không có tác dụng

Đã đọc thẳng source thật của `hyperframe-runtime.js` (bản `0.6.12`, tìm được trong
`npm-cache/_npx`) tìm rule CSS ép `.clip` thành `position:absolute` — **không tìm thấy**
rule như vậy, nên giả thuyết "framework ép mọi `.clip` absolute" cũng bị loại.

**Kết luận trung thực**: đã thu hẹp bug xuống đúng "vì sao `.s1-content{height:100%;
justify-content:center}` không canh giữa được trong 1 container ĐÃ ĐÚNG kích thước",
nhưng chưa xác định được cơ chế thật. Đã revert `scene_01.html` về đúng bản gốc (bỏ hết
text/CSS test) — KHÔNG để lại trạng thái thử nghiệm dở dang trong project thật của user.

**Việc cần làm ở phiên sau** (ưu tiên, vì đây là bug ảnh hưởng chất lượng hiển thị của
MỌI video qua nhánh DashScope):
- So sánh nhị phân: bắt đầu từ 1 scene tối giản (chỉ 1 dòng chữ, không atmosphere, không
  GSAP) rồi thêm dần từng phần cho tới khi bug xuất hiện — cách chắc ăn nhất để cô lập
  đúng dòng CSS/cấu trúc gây lỗi, thay vì đoán nguyên khối như phiên này.
- Có thể liên quan `.s1-atmo` (4 layer atmosphere position:absolute inset:0 nằm TRƯỚC
  `.s1-content` trong DOM) — chưa test giả thuyết "atmosphere layer ảnh hưởng tới sizing
  của sibling sau nó".
- Cân nhắc thêm `hyperframes inspect` vào validation gate của `scene-writer.mjs` (đã có
  sẵn `lint` + `checkCanvasDimensions` + `checkPseudoElementAnimations` — `inspect` là
  công cụ ĐÚNG cho đúng lớp bug này, xem `hyperframes-core` skill: "text spilling out of
  a bubble... content moved off canvas") — NHƯNG nên làm SAU KHI đã hiểu nguyên nhân thật,
  không phải trước, vì tự-sửa không có nguyên nhân rõ ràng dễ khiến model sửa sai hướng
  qua nhiều vòng tốn token vô ích (đúng bài học đã rút ra từ bug `write_file` loop).

---

## ✅ ĐÃ TÌM RA + SỬA XONG (cùng phiên, ngay sau đoạn trên) — root cause thật: `root-composer` tự viết `.clip{position:absolute}` đè framework

User nhấn mạnh đây là bug chặn cứng ("nếu không fix tôi sẽ không thể dùng"), yêu cầu soi
kỹ tiếp — dùng cách bisect nhị phân đã đề xuất ở trên thay vì tiếp tục đoán CSS trên
chính file lỗi.

### Cách làm — cô lập bằng project test sạch, không đoán trên file thật nữa

1. Tạo project test trắng (`hyperframes init` mới), copy NGUYÊN VĂN `scene_01.html` bị
   lỗi vào, viết 1 root tối giản chỉ có đúng 1 scene này → `inspect`: **`ok: true, 0
   lỗi`**. Render thật: layout đúng hoàn toàn, canh giữa đẹp. → **Xác nhận 100%: bản thân
   file scene không có lỗi gì** — lỗi nằm ở phía ROOT, không phải scene.
2. Thay root tối giản bằng ĐÚNG root `index.html` thật của project lỗi (giữ nguyên
   `scene_01.html` đã xác nhận sạch) → bug **tái hiện y hệt** (`top:-14, bottom:154`,
   khớp 100% với lỗi gốc) dù thiếu file `scene_02–05.html`. → Xác nhận lỗi nằm trong
   chính root `index.html`, không liên quan các scene khác.
3. Bóc từng phần của root cho tới khi tìm đúng chỗ: root thật có tự định nghĩa
   `.clip { position: absolute; width: 100%; height: 100%; top: 0; left: 0; }` trong
   `<style>` — **thứ mà root tự viết KHÔNG có trong bất kỳ scaffold/ví dụ nào trước đó**.
   Xoá đúng 1 rule này (không đổi gì khác) → `inspect`: **`ok: true, 0 lỗi`** ngay lập
   tức. Render lại đầy đủ (atmosphere + audio + crossfade thật) → layout hoàn hảo, xác
   nhận bằng frame thật.

**Nguyên nhân**: `class="clip"` là marker riêng của framework để tự quản lý hiện/ẩn
theo thời gian (đọc kỹ `hyperframes-core` skill: *"the framework uses this for
visibility control"*) — KHÔNG phải để author tự style. `root-composer` (dùng
`qwen3.7-flash`) tự suy luận "thấy `class='clip'` trên nhiều element, chắc cần định
nghĩa CSS cho nó" — hợp lý về trực giác nhưng SAI với framework này. Khi root tự gán
`position:absolute` cho `.clip`, nó đè lên cách framework tự mount/tính kích thước cho
scene-host (`data-composition-src`), khiến nội dung sub-composition bên trong co lại
thành khối auto-height nhỏ rồi dồn lên góc trên — đúng cả 2 triệu chứng user báo (chữ
dính, dồn góc). Không phải bug ở `scene-writer` (chưa từng thấy nó tự viết rule này) —
chỉ `root-composer` mắc lỗi này.

### Đã sửa

- `server/tools/validators.mjs` — thêm `checkClipClassOverride(html)`: regex bắt
  `.clip[...]{ ... position:absolute ... }`, trả finding nếu có.
- `root-composer.mjs` — thêm dòng cấm tuyệt đối vào system prompt (giải thích rõ lý do,
  kèm bằng chứng "đã test thật") + nối `checkClipClassOverride` vào retry gate (hard-fail,
  cùng cấp với lint/canvas-dimension).
- `scene-writer.mjs` — thêm phòng ngừa tương tự (chưa từng thấy nó mắc lỗi này, nhưng rẻ
  nên thêm luôn, cùng pattern với các check khác đã áp dụng cho cả 2 agent).

### Đã test lại thật qua DashScope (`qwen3.7-flash`, đúng yêu cầu user) trên chính project bị lỗi

Chạy lại `test-root-composer.mjs` trên `model-kimi-ra-doi-khien-claude-de-chung`: PASS
sau 3 attempt (149.627 token — hơi cao vì model vẫn còn thói quen gọi `list_dir` thừa ở
2 attempt đầu, chưa sửa, xem mục "việc nhỏ" bên dưới), **root mới KHÔNG còn viết
`.clip{position:absolute}` nữa** — mỗi atmosphere layer (`bg-dots`, `bg-glow`...) giờ có
class riêng với `position:absolute` riêng thay vì gộp vào `.clip`. `checkClipClassOverride`
chạy trên file mới → `0 finding`. `inspect` → lỗi của `scene_01` biến mất hoàn toàn (2 lỗi
còn lại là của `scene_05` — nội dung tràn quá khung, vấn đề khác hẳn, không liên quan
`.clip`, chưa xử lý). Render lại đầy đủ → `ffprobe` xác nhận `1080×1920`, trích frame
scene 1 xác nhận layout đúng hoàn toàn — không còn dính chữ, không còn dồn góc.

**Kết luận**: bug chặn cứng mà user báo đã được xác định nguyên nhân chính xác 100%
(không phải suy đoán) và sửa tại gốc (prompt + validator, áp dụng cho MỌI video sau
này, không phải vá riêng lẻ từng project). Đã verify bằng bisection cô lập LẪN test lại
trên đúng project thật bị lỗi ban đầu.

### Còn lại — KHÔNG thuộc scope bug này, ghi lại để không quên

- `scene_05.html` của project `model-kimi-ra-doi-khien-claude-de-chung` bị tràn nội dung
  (content cao hơn 1920px, xem lỗi `container_overflow`/`text_box_overflow` từ `inspect`)
  — vấn đề riêng của scene đó (nội dung/font-size), không phải bug `.clip`. Chưa sửa.
- `root-composer` vẫn còn tốn turn/token vào `list_dir` thừa dù prompt đã cấm — giống
  đúng bug đã sửa cho `video-planner` trước đây nhưng chưa áp dụng triệt để cho
  `root-composer`. Cân nhắc phiên sau.
- Nhận xét "chữ quá nhỏ so với tỉ lệ khung hình" của user — có thể là vấn đề RIÊNG (model
  chọn font-size không tính theo canvas 1080×1920 rất cao/dọc), tách biệt khỏi bug
  `.clip` — chưa điều tra.

---

## Đã làm — Phase 2 (Backend API + job queue) ✅ xong, đã test qua HTTP thật

Thêm dependency `express` vào `server/package.json` (`npm install` trong `server/` cần
chạy trước khi dùng — trước đây quên bước này gây `ERR_MODULE_NOT_FOUND: msedge-tts`
khi chạy CLI, nay gây lỗi tương tự nếu thiếu `express`).

| File | Vai trò |
|---|---|
| `server/lib/project-id.mjs` | Map id trong URL ↔ thư mục project trên đĩa. Id chính là path tương đối dưới `output/` (URL-encoded) — không có DB. Sandbox chống path traversal giống hệt cách `fs-tools.mjs` sandbox agent (chặn `..`, chặn escape ra ngoài `output/`) |
| `server/jobs/job-status.mjs` | `job-status.json` trong từng project dir + 1 `EventEmitter` in-process cho SSE. `steps[step]` là snapshot gọn `{step, status, at, error?}` chỉ cập nhật khi có chuyển trạng thái running/done/error; toàn bộ event chi tiết (tool call, TTS per-scene, lint-retry...) nằm ở mảng `events` append-only riêng (cap 500) — **tách ra sau khi phát hiện bug thật**: gộp chung cả hai bằng object-spread khiến `steps[step]` cuối cùng bị lẫn field không liên quan giữa các loại event khác nhau (xem "Bug phát hiện" bên dưới) |
| `server/jobs/queue.mjs` | `ConcurrencyQueue` — giới hạn số job chạy đồng thời theo provider (`dashscope`, `tts`), qua env `DASHSCOPE_CONCURRENCY`/`TTS_CONCURRENCY` (mặc định 2/3). Cần vì bước 5 (scene-writer) chạy song song nhiều scene cùng lúc |
| `server/pipeline/new-project.mjs` | Logic tạo project (slug, `hyperframes init`, copy DESIGN.md) tách ra từ `scripts/new-video.mjs` để CLI và API dùng chung 1 nguồn — không lặp code |
| `server/pipeline/generate-audio.mjs` | Toàn bộ logic TTS pipeline tách ra từ `scripts/generate-audio.mjs`, `console.log` cũ đổi thành `onEvent(...)` để cả CLI lẫn API tự format log/progress theo cách riêng |
| `server/routes.mjs` | Router Express: `POST /projects`, `GET /projects/:id`, `POST /projects/:id/plan`, `.../audio`, `.../video-plan`, `.../scenes/:sceneId/generate`, `.../render`, `GET /projects/:id/events` (SSE). Mọi bước tốn nhiều turn (agent LLM) chạy nền (`runInBackground`), response trả ngay `202` — client theo dõi qua SSE hoặc poll `GET /projects/:id` |
| `server/index.mjs` | Express app entry, `PORT` env (mặc định 3001) |

`scripts/new-video.mjs` và `scripts/generate-audio.mjs` được viết lại thành wrapper mỏng
gọi 2 module pipeline trên — hành vi CLI giữ nguyên (đã test lại `slugify` + chạy full
audio pipeline qua edge-tts, output giống bản gốc).

### Bug thật phát hiện + vá trong lúc test (không phải giả định)

1. **`npx hyperframes init` cần TTY, fail khi gọi qua API** — lỗi thật:
   `Non-interactive init requires --example, --video, or --audio`. Bản CLI gốc chạy
   `stdio: "inherit"` nên có TTY tương tác (prompt chọn template); gọi qua
   `execSync({stdio:"pipe"})` từ route không có TTY nên fail ngay. Đã vá:
   `new-project.mjs` giờ luôn gọi với `--example blank --non-interactive`. Đánh đổi:
   CLI cũng mất luôn prompt chọn template (giờ luôn "blank") — chấp nhận được vì
   composition thật luôn bị `/hyperframes` skill ghi đè hoàn toàn ở bước 5, template
   ban đầu không có ý nghĩa thực tế.
2. **`job-status.json` bị lẫn field khi merge nhiều loại event khác nhau** — phát hiện
   khi chạy `POST /plan` thật qua DashScope và đọc lại `job-status.json`: field cuối
   cùng của `steps.plan` là hỗn hợp `{type, message, name, result}` từ 3 event không
   liên quan (assistant turn, tool call, status "done") do dùng `{...prev, ...event}`.
   Đã vá bằng cách tách `steps` (snapshot gọn) khỏi `events` (log chi tiết) — xem mô
   tả ở bảng trên. Test lại xác nhận `steps.plan` giờ chỉ còn `{step, status, at}`.
3. **`POST /projects` trả 500 thay vì 400 khi thiếu `idea`** — `createProject()` throw
   lỗi input hợp lệ (thiếu ý tưởng, project đã tồn tại) nhưng route ban đầu để lỗi rơi
   xuống error handler chung (500). Đã vá: bắt riêng lỗi từ `createProject`, trả 400.
4. **Job thất bại vẫn bị ghi `"done"` trong `job-status.json`** — `runSceneWriter()` và
   `hyperframes-cli.mjs`'s `render()` báo lỗi bằng cách RESOLVE `{ok: false, ...}` thay
   vì throw (đúng thiết kế của 2 hàm đó khi dùng trực tiếp ở Phase 1 — caller ở đó tự
   check `result.ok`). Nhưng `job-status.runStep()` chỉ coi step là lỗi khi promise bị
   reject, nên 1 scene-writer thất bại thật (hết `maxFixAttempts`) hoặc 1 lần render
   lỗi thật sẽ vẫn hiện `status: "done"` — false success, nguy hiểm nhất trong 4 bug vì
   Phase 3 (frontend) sẽ tin thẳng vào field này để hiển thị cho user. Đã vá:
   `runStep()` giờ kiểm tra `result.ok === false` trên giá trị resolve và coi như lỗi
   (throw lại) — test bằng 1 task giả trả `{ok:false, error:"..."}`, xác nhận
   `job-status.json` giờ ghi đúng `status: "error"` kèm message.

### Đã test thật qua HTTP (không phải chỉ đọc code)

- `POST /projects` — thiếu `idea` → 400; tạo thành công → 201 + đúng `id`/`projectPath`;
  gọi `npx hyperframes init` thật, tạo scaffold thật trên đĩa.
- `GET /projects/:id` — id hợp lệ trả status; id không tồn tại → 404; id path traversal
  (`../../etc/passwd`, URL-encoded) → 400, không đọc được file ngoài `output/`.
- `POST /projects/:id/plan` — thiếu `audience` → 400; chạy thật qua DashScope (idea
  thật) → `202`, job chạy nền, `scenes.json` được ghi thật, `job-status.json` cập nhật
  đúng `done`, SSE stream nhận được event (đã thử `curl -N .../events`).
- Dọn sạch 2 project test tạo ra trong lúc test (`phase-2-api-smoke-test-video`,
  `-video-2`) sau khi xong — không phải project thật của user.

### Đã test tiếp 4 route còn lại — full pipeline thật qua HTTP (cùng phiên, sau khi hỏi
"tiếp tục")

Project `phase-2-full-pipeline-smoke-test`, chạy tuần tự qua `curl` thật, poll
`GET /projects/:id` tới khi từng step `done`:

1. `POST /plan` (idea + audience thật) → `scenes.json` được ghi → `done`.
2. `POST /audio` (`ttsProvider: "edge-tts"`) → TTS thật qua edge-tts, `scenes-with-timing.json`
   được ghi → `done`. (Job chạy lâu hơn timeout lệnh curl/poll 120s của tool — không
   phải lỗi, chỉ là job dài hơn 1 lần gọi `curl`; poll lại sau vẫn thấy `done` đúng.)
3. `POST /video-plan` → `video-plan.json` (7 scene) được ghi qua DashScope thật → `done`.
4. `POST /scenes/scene_01/generate` → `compositions/scene_01.html` được ghi. Log
   `events` cho thấy vòng lint auto-fix hoạt động đúng qua API: attempt 0 có 1 finding
   mới, attempt 1 còn 0 → `done`. Không có `static-check` event → không có cảnh báo
   pseudo-element (scene sạch).
5. `POST /render` → gọi `npx hyperframes render` thật, sinh `renders/video_....mp4`
   thật (dùng scaffold "blank" từ `hyperframes init`, vì bước 6 "viết root index.html"
   trong CLAUDE.md là bước thủ công/agent riêng, KHÔNG nằm trong scope Phase 2 — route
   `/render` chỉ gọi render trên `index.html` hiện có của project, đúng như thiết kế).

Trong lúc test bước 5 phát hiện **bug #4** ở trên (job thất bại vẫn ghi "done") — đã vá
và test lại bằng task giả lập, xem chi tiết trong bảng "Bug thật phát hiện" phía trên.

Đã dọn project test (`phase-2-full-pipeline-smoke-test`) sau khi xong.

**Kết luận**: cả 7 route của Phase 2 đã chạy thật qua HTTP ít nhất 1 lần, kể cả nhánh
lỗi (`ok:false` → `error` sau khi vá). Sẵn sàng cho Phase 3 dựa vào các route này.

---

## Đã làm — Phase 3 (Frontend) ✅ xong, đã test trong trình duyệt thật (Playwright)

Vite + React tối giản trong `web/` (không router, không state library — 1 project =
1 trang, state giữ trong `localStorage` để reload không mất tiến độ).

| File | Vai trò |
|---|---|
| `web/src/api.js` | Wrapper `fetch` gọi tất cả route của server (`VITE_API_BASE`, mặc định `http://localhost:3001`) |
| `web/src/useJobStatus.js` | Hook `EventSource` subscribe `/projects/:id/events`, giữ `{steps, events}` live |
| `web/src/components/ProjectForm.jsx` | Form nhập ý tưởng → `POST /projects` |
| `web/src/components/Pipeline.jsx` | Orchestrator chính: 4 `StepRow` (plan/audio/video-plan/render), mỗi step có nút trigger + `StatusBadge` sống theo SSE, disable đến khi step trước xong |
| `web/src/components/CheckpointPanel.jsx` | Panel thu gọn hiển thị raw `scenes.json`/`video-plan.json` sau khi step tương ứng `done` — đúng yêu cầu "checkpoint review" trong plan gốc |
| `web/src/components/SceneGrid.jsx` | Lưới scene từ `video-plan.json`, mỗi scene có `StatusBadge` riêng (`scene:<id>`) + nút Generate/Generate lại |
| `web/src/components/PreviewFrame.jsx` | Nút "Mở preview" (lazy — chỉ start server khi bấm) → `<iframe>` |

### Backend bổ sung cho Phase 3

- `GET /projects/:id/files/:name` — đọc lại checkpoint file, **whitelist cứng**
  (`scenes.json`, `video-plan.json`, `scenes-with-timing.json`, `master_content.md`,
  `DESIGN.md`) để client không đọc được file tuỳ ý trong project (asset, config...).
- `server/jobs/preview.mjs` + `GET /projects/:id/preview-url` — quản lý vòng đời
  `hyperframes preview` on-demand theo project, tự kill sau
  `PREVIEW_IDLE_TIMEOUT_MS` (mặc định 10 phút) không có request nào.
- CORS (`cors` package) bật cho toàn bộ server — cần vì frontend (`:5173`) và backend
  (`:3001`) khác origin trong dev.

### Bug thật phát hiện + vá trong lúc test (2 bug, cả hai đều nghiêm trọng)

1. **`hyperframes preview --background` không tồn tại ở bản pin `0.6.12`** — `--help`
   của bản `0.7.86` (bản mới nhất lúc test `npx`) liệt kê `--background` với mô tả
   "remains running after the command exits", nên thiết kế ban đầu của
   `preview.mjs` dựa vào flag đó. Nhưng bản `0.6.12` (pin cứng, cùng version với
   `hyperframes-cli.mjs`) không có flag này — bị âm thầm bỏ qua, lệnh chạy ở chế độ
   foreground/interactive bình thường và treo mãi (đã xác nhận: gọi trực tiếp qua
   `npx` cũng treo >120s dù server preview thực sự đã lên và phục vụ được ở đúng
   port). Đã vá: bỏ hẳn cách dựa vào flag CLI, tự `spawn()` tiến trình `detached`,
   tự poll `fetch` tới khi server sẵn sàng, tự quản lý dừng bằng `tree-kill` (xử lý
   luôn khác biệt Windows/macOS trong việc kill process tree — cùng lớp vấn đề đã
   gặp với `npx` ở `hyperframes-cli.mjs`).
2. **Proxy path-prefix cho preview không hoạt động vì asset path tuyệt đối** — thiết
   kế ban đầu mount `/projects/:id/preview/*` qua `http-proxy-middleware` để mọi thứ
   đi qua 1 origin. Test bằng Playwright thật (mở preview trong iframe, đọc
   `console --errors`) phát hiện: HTML của HyperFrames Studio tham chiếu bundle bằng
   path tuyệt đối (`/assets/index-*.js`), nên trình duyệt request thẳng
   `http://localhost:3001/assets/...` (origin của server, KHÔNG qua prefix proxy) →
   404 → server trả HTML lỗi nhưng khai `Content-Type` sai → trình duyệt từ chối
   thực thi (MIME check). Route proxy dùng `http-proxy-middleware` không cứu được
   vì vấn đề nằm ở chính HTML app, không phải ở tầng proxy. Đã đổi kiến trúc: bỏ
   hẳn proxy path-prefix, thêm `GET /projects/:id/preview-url` trả thẳng
   `http://localhost:<port>/` (cổng riêng của tiến trình preview), frontend set
   `<iframe src>` trỏ thẳng vào đó — không có vấn đề CORS/mixed-content vì cùng
   `localhost`. Gỡ bỏ dependency `http-proxy-middleware` (không dùng nữa).

### Đã test bằng Playwright (headless Chromium thật, không phải chỉ đọc code)

Cài `playwright` + Chromium tạm ở `/tmp/pw-test` (không phải dependency của repo — chỉ
dùng để verify phiên này, không commit gì thêm vào repo cho việc này).

- Load `http://localhost:5173` — render đúng, **0 lỗi console**.
- Golden path thật: điền ý tưởng → "Tạo project" (gọi `POST /projects` thật) → điền
  audience → "Chạy content-planner" (gọi DashScope thật) → chờ SSE cập nhật
  `StatusBadge` từ "Đang chạy…" sang "Xong" (screenshot xác nhận) → checkpoint panel
  `scenes.json` tự xuất hiện, mở ra đọc được nội dung thật DashScope vừa viết.
- Preview: mở project có sẵn compositions (`chatgpt-content-automation`), bấm
  "Mở preview" → phát hiện + vá bug #2 ở trên → sau khi vá, screenshot xác nhận
  HyperFrames Studio load đầy đủ UI thật, danh sách đúng `scene_01`/`scene_02`/...
  của project đó.
- Dọn dẹp: xoá project test (`phase-3-ui-golden-path-test`), kill mọi tiến trình
  `hyperframes preview` còn sót, xoá `.thumbnails/` (cache do chính `hyperframes
  preview` sinh ra trong lúc test, dính vào 1 project thật) — đã thêm `.thumbnails/`
  vào `.gitignore` để không lặp lại.

---

## Đã làm — Tách model rẻ/đắt theo bước (phiên 2026-07-31→08-01)

Theo yêu cầu user (sau khi thấy chi phí token cao): `run-agent.mjs` thêm
`CHEAP_MODEL = process.env.DASHSCOPE_MODEL_CHEAP || "qwen-turbo"`, tách khỏi
`DEFAULT_MODEL` (`qwen-plus`, giữ nguyên cho content-planner/video-planner).
`scene-writer.mjs` và `root-composer.mjs` đổi sang dùng `CHEAP_MODEL` mặc định (chạy
nhiều lần/video nhất, việc chủ yếu là bám skill/convention hơn là sáng tạo).

### Rủi ro đã kiểm tra trước khi merge — không chỉ tin lời mình nói

Comment cũ trong `dashscope.mjs` (viết từ Phase 1) ghi rõ `qwen-turbo` **mới chỉ xác
nhận cho chat thường, CHƯA xác nhận cho `tool_calls`** — trong khi scene-writer/
root-composer bắt buộc phải dùng tool `write_file`. Đã test thật bằng 1 lệnh gọi tối
giản (tool `write_file` giả) trước khi đổi default: `qwen-turbo` trả về đúng
`tool_calls` với argument hợp lệ → an toàn để dùng. Đã cập nhật lại comment trong
`dashscope.mjs` cho đúng thực tế.

### Bug thật phát hiện qua A/B test trực tiếp — không phải do model rẻ

Chạy `test-scene-writer.mjs` thật trên `scene_04` (project `ai-trong-marketing`) với
`qwen-turbo`: **FAILED 4/4 attempt**, cùng 1 lỗi `timeline_id_mismatch` lặp lại y hệt
mỗi lần (đăng ký `window.__timelines["scene_04"]` — gạch dưới, khớp theo `sceneId` đầu
vào — nhưng element lại có `data-composition-id="scene-04"` — gạch ngang). Model không
tự sửa được dù được cho xem đúng lỗi 3 lần liên tiếp (bằng chứng cụ thể cho rủi ro
"anchoring bias" đã cảnh báo trước khi làm tính năng giữ hội thoại qua retry).

**Truy ra nguyên nhân gốc: prompt của chính mình mơ hồ**, không phải model kém. Dòng
override cũ trong `scene-writer.mjs` chỉ nói "CSS selector: `#scene-04` — KHÔNG dùng
`[data-composition-id=...]`" — câu này chỉ nói về cú pháp CSS selector, KHÔNG nói rõ
giá trị thật của attribute `id`/`data-composition-id` trên element phải là gì, cũng
không nói rõ key nào phải đăng ký vào `window.__timelines`. Đã sửa: viết rõ ràng
tường minh cả 2 điều này + cảnh báo trực tiếp không được nhầm với `sceneId` (gạch dưới,
chỉ là tên field input). Test lại ngay sau khi sửa: **PASS trong 2 attempt**, kiểm tra
file thật xác nhận `id="scene-04"`, `data-composition-id="scene-04"`,
`window.__timelines["scene-04"]` khớp nhau hoàn toàn đúng.

### Chi phí thực tế — kết quả có phần trái ngược kỳ vọng, báo trung thực

Chạy lại lần 2 (scene khác, sau khi thêm dòng in `usage` vào `test-scene-writer.mjs`):
**3 attempt, 103.642 token cho 1 scene** — CAO HƠN hẳn ước tính trước đó cho
`qwen-plus` (~20-35k/scene). Chất lượng vẫn đúng (lint pass, convention đúng), nhưng số
lần attempt dao động giữa các lần chạy (2 vs 3) khiến tổng token không ổn định. **Chưa
xác nhận việc đổi sang `qwen-turbo` có thực sự rẻ hơn bằng tiền thật hay không** — vì
`qwen-turbo` rẻ hơn `qwen-plus` theo đơn giá/token (chưa có số giá xác thực để so sánh
chính xác), nhưng nếu cần nhiều attempt hơn để hội tụ thì có thể triệt tiêu lợi thế đó.
Khuyến nghị: theo dõi chi phí $ thật trong console DashScope sau vài lần chạy thật, so
sánh trước/sau khi đổi model, thay vì tin vào số token ước tính.

### Cập nhật: đổi sang `qwen3.7-flash` — tốt hơn hẳn `qwen-turbo` (phiên 2026-08-01)

User tự thêm `DASHSCOPE_MODEL_CHEAP=qwen3.7-flash` (và `DASHSCOPE_MODEL=qwen3.6-plus`)
vào `.env`. Đây là **model có reasoning** (trả về `reasoning_content` — chuỗi suy luận
ẩn trước câu trả lời, tốn thêm `reasoning_tokens` mỗi lượt, xác nhận qua field
`completion_tokens_details.reasoning_tokens` trong response thật).

Test lại đúng quy trình đã làm với turbo (xác nhận `tool_calls` hoạt động trước, rồi
test chất lượng thật trên scene thật):

- `tool_calls` hoạt động đúng cho cả `qwen3.7-flash` lẫn `qwen3.6-plus` (test bằng
  lệnh gọi tối giản trước khi tin dùng).
- `scene-writer` test 2 lần trên scene thật (project `ai-trong-marketing`): **PASS cả
  2 lần** — 32.864 token (1 attempt) và 66.324 token (2 attempt). Tốt hơn hẳn
  `qwen-turbo` (fail 4/4 lần đầu, rồi 103.642 token/3 attempt ở lần sau khi đã sửa
  prompt).
- `root-composer` test với đủ 6 scene: **PASS lần đầu**, chỉ 37.491 token — rẻ hơn cả
  lần chạy 3 scene trước đó (50k token) dù giờ ghép nhiều scene hơn.
- Thêm dòng in `usage` vào `test-scene-writer.mjs`/`test-root-composer.mjs` (trước đó
  chỉ 2/4 file test có sẵn dòng này) để tiện đo token khi test thủ công.

**Phát hiện 1 bug thật riêng biệt trong lúc verify bằng cách xem video render** (trích
frame giữa video bằng `ffmpeg`, không chỉ tin `render` trả `ok:true`): nội dung 1 scene
bị dồn lên góc trên, phần lớn khung hình đen. Nguyên nhân: `scene_01.html` của project
test này có kích thước 1080×1920 (portrait, sinh ra ở 1 lần test rất sớm trong phiên)
trong khi `scene_02–06` đều 1920×1080 (landscape) — dữ liệu cũ lẫn lộn từ nhiều lần
test, KHÔNG phải do đổi model gây ra. Nhưng lộ ra lỗ hổng thật:
**`scene-writer.mjs` hiện không được truyền tường minh kích thước canvas mục tiêu**
(`video-plan.json` có field `format` — vd `"9:16"` — nhưng không được đưa vào prompt
của scene-writer), nên không có gì đảm bảo các scene sinh ra nhất quán kích thước với
nhau nếu chạy nhiều lần cách nhau hoặc đổi orientation giữa chừng.

### ✅ Đã sửa (cùng phiên, ngay sau khi phát hiện) — canvas dimension mismatch

- `server/lib/canvas.mjs` (mới) — `dimensionsForFormat("9:16"|"16:9")`, nguồn sự thật
  duy nhất cho mapping format → width/height, dùng chung được cho cả
  scene-writer/root-composer (root-composer chưa nối, chỉ scene-writer).
- `scene-writer.mjs` — nhận thêm param `format`, thêm dòng bắt buộc
  `data-width`/`data-height` đúng số vào system prompt.
- `server/tools/validators.mjs` — thêm `checkCanvasDimensions(html, expectedWidth,
  expectedHeight)`, đưa vào **cùng gate retry với lint** (không chỉ warning) — vì lint
  của hyperframes kiểm tra từng file độc lập, không thể tự phát hiện 2 scene lệch kích
  thước với nhau.
- `routes.mjs` (`POST /scenes/:sceneId/generate`) và `test-scene-writer.mjs` — truyền
  `videoPlan.format` vào `runSceneWriter`.

**Đã test thật, đúng bằng chứng cụ thể (không chỉ unit test)**:
- Test nhầm lần đầu: regenerate `scene_01` (hoá ra vốn ĐÃ đúng 1080×1920 khớp
  `format:"9:16"` của project) — tốn bất thường 378k token (3 attempt, nhiều turn) vì
  có 8 lỗi lint khác không liên quan đến dimension, không phải do cơ chế mới gây ra.
- Test đúng lần 2: regenerate `scene_02` (thực sự sai, đang 1920×1080) — **PASS ngay
  lần đầu, tự sửa đúng thành 1080×1920**, xác nhận bằng `grep` trực tiếp trên file +
  lint 0 lỗi. Cơ chế hoạt động đúng như thiết kế.
- `scene_03–06` của project test này vẫn còn sai kích thước (chưa regenerate — không
  cần thiết vì đây chỉ là project test, không phải nội dung thật của user; cơ chế đã
  xác nhận đúng qua scene_02 là đủ).

---

## Đã làm — 5 tính năng UI theo yêu cầu user (phiên 2026-07-31, sau root-composer)

User tự tay test UI, phát hiện root-composer đã render ra **video thật có nội dung**
(không còn đen — xác nhận bằng `ffprobe` + trích frame giữa video bằng `ffmpeg`, thấy
đúng layout two-column theo DESIGN.md). Sau đó yêu cầu thêm 5 việc UI:

1. **Chọn project làm việc** — `GET /projects` (route mới, `server/lib/project-id.mjs`
   thêm `listProjects()` quét `output/YYYY-MM-DD/{slug}/video/`, chỉ liệt kê project đã
   qua `hyperframes init` thật (có `index.html`), sort mới nhất trước). Frontend:
   `ProjectPicker.jsx` — danh sách project cũ, bấm vào để tiếp tục làm việc (không mất
   tiến độ, đọc lại đúng `job-status.json` qua SSE snapshot).
2. **Chọn kích thước ngang/dọc, mặc định dọc** — `createProject()` nhận
   `orientation: "portrait"|"landscape"`, truyền `--resolution portrait|landscape` vào
   `hyperframes init` (đã test thật: portrait → 1080×1920, landscape → 1920×1080, xác
   nhận qua `grep data-width/data-height` trên `index.html` sinh ra). CLI
   `scripts/new-video.mjs` cũng hỏi thêm câu này để không lệch với API. Frontend:
   radio chọn trong `ProjectForm.jsx`, mặc định "Dọc".
3. **UI full màn hình trên PC** — phát hiện bug CSS thật khi test: `.app` là flex item
   bên trong `#root` (Vite scaffold có `#root { display:flex; flex-direction:column }`),
   `margin:0 auto` khiến nó co theo nội dung thay vì giãn hết `max-width` (đo trực tiếp
   qua Playwright: `max-width` đã đúng 1180px nhưng width thật chỉ 737px). Sửa bằng
   thêm `width:100%` — đo lại đúng ~1124px (giới hạn bởi `#root` width cố định 1126px
   của chính Vite scaffold, chấp nhận được).
4. **Xem video ngay trên UI** — 2 route mới: `GET /projects/:id/renders` (liệt kê file
   `.mp4` trong `renders/`, lọc bỏ rác `._*` — phát hiện bug nhỏ lúc test: file rác
   AppleDouble cũng đuôi `.mp4` nên lọt qua filter ban đầu, đã vá), và
   `GET /projects/:id/renders/:name` dùng `res.sendFile()` (không phải stream tay) để
   Express tự xử lý HTTP Range request — đã test thật bằng `curl -r 0-1023`, xác nhận
   `206 Partial Content` đúng chuẩn cho `<video>` tua được. Frontend: `RenderPlayer.jsx`
   dùng thẻ `<video controls>` native, tự hiện bản render mới nhất. Riêng "xem từng
   scene" — không cần route mới: HyperFrames Studio (đã có qua nút "Mở preview") vốn đã
   có danh sách scene bên trái, bấm vào xem riêng từng cái — chỉ thêm 1 dòng ghi chú
   hướng dẫn trong UI.
5. **Thống kê token đã dùng** — xác nhận trước khi làm: gọi thật 1 lần `chatCompletion`
   rẻ nhất có thể, thấy DashScope trả về `usage: {prompt_tokens, completion_tokens,
   total_tokens}` chuẩn OpenAI-compat (và tiện thấy luôn field `cached_tokens` — gợi ý
   DashScope có thể tự cache prefix, chưa xác minh sâu). Đã nối: `run-agent.mjs` cộng
   dồn usage qua các turn của 1 lần gọi; `scene-writer.mjs`/`root-composer.mjs` cộng dồn
   tiếp qua các attempt retry (kể cả khi throw lỗi — `err.usage` được gắn vào để không
   mất số liệu của attempt thất bại); `job-status.mjs` lưu `usage` vào từng step +
   `totalUsage` cộng dồn toàn project. Frontend: `TokenBadge.jsx` (hiện cạnh mỗi step),
   tổng token ở đầu trang, `useJobStatus.js` tự cộng dồn `totalUsage` qua SSE event
   sống (không cần reload) — **đã test bằng 1 lần gọi content-planner thật**, hiện đúng
   "10.5k token" cạnh step và "Tổng token đã dùng: 10.452" ở đầu trang.

**Đã test toàn bộ bằng Playwright thật** (không chỉ đọc code): tạo project mới với
orientation, chọn lại project cũ từ danh sách, xem video render bằng `<video>` native,
badge token hiện đúng số liệu thật từ 1 lần gọi DashScope thật — cả 3 lần đều 0 lỗi
console. Đã dọn project test + file rác sau khi xong.

---

## Việc nhỏ ✅ xong (phiên 2026-07-31)

Thêm `server/tools/validators.mjs` — 2 hàm kiểm tra thuần code, không gọi LLM:

- `checkDurationSum({ total, scenes, key, toleranceSeconds })` — so tổng field
  `estimated_duration`/`duration` của các scene với field tổng (`total_estimated_duration`
  ở scenes.json, `total_duration` ở video-plan.json). Sai lệch > 1s → `{ ok: false, ... }`.
  Đã nối vào:
  - `content-planner.mjs` → check `scenes.json` sau khi agent ghi xong, trả thêm
    `result.durationCheck`, bắn `onEvent({type:"duration-check", ...})` nếu lệch.
  - `video-planner.mjs` → check `video-plan.json` tương tự.
- `checkPseudoElementAnimations(html)` — regex bắt `xxx.to/from/fromTo/set("...::before"
  hoặc "...::after"...)` (không chỉ `gsap.` mà cả biến timeline như `tl.to(...)` — đúng
  bug thật đã gặp là `tl.to("#scene-01::after", ...)`). Đã nối vào `scene-writer.mjs`:
  sau khi lint pass (0 finding mới), đọc lại file HTML vừa ghi, chạy check, trả
  `result.staticWarnings` + bắn `onEvent({type:"static-check", ...})` nếu có. Đây là
  warning tĩnh, KHÔNG chặn agent (khác với vòng lint auto-fix) — vì mục tiêu chỉ là
  làm lộ lỗi ra ngoài để người review thấy, chưa tự sửa được.

Cả 2 hàm đã test độc lập bằng `node -e` (không cần gọi DashScope thật) — xem output
mẫu trong commit liên quan. 3 file `test-*.mjs` cũng in thêm các cảnh báo này ra console.

`video-planner.mjs` system prompt đã thêm dòng cấm gọi lại `read_file` cho DESIGN.md và
scenes-with-timing.json (đã nhúng sẵn trong user prompt) — tiết kiệm 2 turn thừa quan
sát được lúc test.

### Đã test end-to-end qua DashScope thật (cùng phiên 2026-07-31, sau khi cài `server/`
deps bằng `npm install` — trước đó chưa cài nên `generate-audio.mjs --env TTS_PROVIDER=edge-tts`
báo `ERR_MODULE_NOT_FOUND msedge-tts`)

Chủ đề test: "5 mẹo dùng ChatGPT tiết kiệm 2 giờ mỗi ngày cho dân văn phòng", project
tạm `scratchpad-e2e-test` (đã xoá sau khi test xong, không phải project thật).

- **content-planner**: 2 turn, viết đủ 2 file. `durationCheck` bắt đúng lệch thật:
  `total_estimated_duration=45` nhưng tổng scene = 51 → `{ok:false, diff:-6}`. Confirm
  validator hoạt động, và cũng confirm model DashScope vẫn mắc đúng lỗi đã ghi nhận
  trước ("field tổng không khớp thực tế").
- **video-planner**: chỉ 2 turn (trước là 4, có 2 lần `read_file` thừa) — fix "cấm gọi
  lại read_file" có tác dụng thật, tiết kiệm turn quan sát được. `durationCheck` bắt
  lệch `total_duration=45` vs tổng scene thật 57.49 → `{ok:false, diff:-12.49}`.
- **scene-writer** (scene_01): lint báo FAILED 4/4 attempt với 3 lỗi
  `root_missing_composition_id` / `root_missing_dimensions` / `missing_timeline_registry`
  — nhưng **đây là false negative**, không phải lỗi thật của agent. Nguyên nhân: máy
  test chạy trên ổ đĩa ngoài không hỗ trợ xattr gốc (macOS), nên MỌI lần ghi file (kể
  cả `fs.writeFileSync` trong `fs-tools.mjs`) sinh kèm 1 file rác AppleDouble
  `._scene_01.html` cạnh file thật — và `hyperframes lint` quét luôn file rác đó, coi
  nó là 1 composition thiếu attribute. Xoá `._scene_01.html` rồi lint lại thủ công:
  `{ok:true, errorCount:0, warningCount:0}` — file HTML thật hoàn toàn sạch. Đọc tay
  file `scene_01.html`: đúng convention (selector `#scene-01`, class `.s1-`, `class="clip"`,
  timeline đăng ký đúng), KHÔNG có gsap animate pseudo-element (2 pseudo-element chỉ dùng
  CSS thuần, không đụng gsap) → `checkPseudoElementAnimations()` chạy trên file thật trả
  về `[]` đúng như kỳ vọng (không false-positive).

**Phát hiện mới (ngoài phạm vi 3 việc nhỏ, đã sửa luôn vì rẻ và liên quan trực tiếp)**:
ổ đĩa dự án ("New Volume") sinh file `._*` (AppleDouble) cho MỌI lần ghi file — không
riêng gì server/agent, cả Write/Edit thường của Claude Code cũng dính (thấy `._plan.md`,
`server/agents/._*.mjs` sau khi sửa các file trong phiên này). Đây chính là nguồn gốc
file `._.env` đã ghi nhận từ đầu phiên trước, và là nguyên nhân false-negative của
scene-writer ở trên. Đã xử lý:
- Thêm `._*` vào `.gitignore` (root).
- Xoá toàn bộ file `._*` rác hiện có trong repo (`find . -name '._*' -delete`, đã trừ `.git/`).

**✅ Đã vá (cùng phiên, sau khi hỏi user chọn hướng "patch code")**: `hyperframes-cli.mjs`
giờ có `cleanAppleDouble(dir)` — quét đệ quy `projectDir` (bỏ qua `node_modules/`, `.git/`,
`.hyperframes/`), xoá mọi file `._*`, gọi TRƯỚC mỗi lần `lint()` và `validate()`. Đã test
lại đúng kịch bản gặp bug: tạo `scene_01.html` thật + `._scene_01.html` rác cạnh nhau
trong 1 project `hyperframes init` sạch, gọi `lint()` → file rác bị xoá trước khi lint
chạy, kết quả `errorCount: 0` (không còn báo `root_missing_composition_id` giả). Không
chọn hướng "chuyển ổ đĩa" vì cần user tự thao tác di chuyển repo, và fix code này chịu
được nếu sau này chạy lại trên ổ ngoài khác hoặc máy khác gặp tình huống tương tự.

- Các vấn đề review repo từ đầu phiên trước (không thuộc scope nhánh này, ghi lại cho
  đủ, chưa dọn): `output/` có project test/trùng/legacy đã bị commit
  (`spotify-card-viral-tiktok`, `test-reorganize`, `e2e-chatgpt-5-phut` dùng schema cũ
  `plans.json`), và 1 file `.DS_Store` bị commit nhầm.
- `server/` cần `npm install` trước khi chạy được (`msedge-tts` không có sẵn) — không
  phải bug, nhưng nên ghi vào README/hướng dẫn onboarding vì gây lỗi khó hiểu
  (`ERR_MODULE_NOT_FOUND`) nếu quên bước này.

---

## Lệnh để test lại từng phần khi quay lại phiên sau

```bash
# TTS free (không cần key)
TTS_PROVIDER=edge-tts node --env-file=.env scripts/generate-audio.mjs <projectDir>

# Agent content-planner qua DashScope
node --env-file=.env server/agents/test-content-planner.mjs "<ý tưởng>" <projectDir>

# Agent video-planner qua DashScope (cần projectDir đã có DESIGN.md + scenes-with-timing.json)
node --env-file=.env server/agents/test-video-planner.mjs <projectDir>

# Agent scene-writer qua DashScope (cần projectDir đã có video-plan.json + index.html
# scaffold từ `npx hyperframes init` — nếu test project tự tạo bằng tay, nhớ chạy
# `npx hyperframes init .` trong 1 thư mục rỗng rồi copy index.html/hyperframes.json/
# meta.json/package.json qua, vì lint cần index.html mới chạy được)
node --env-file=.env server/agents/test-scene-writer.mjs <projectDir> <sceneId>
```

## Quyết định tiếp theo

Phase 0 + Phase 1 đã xong và validate thật. 3 "việc nhỏ" (duration check + pseudo-element
static check + bớt read_file thừa) đã xong VÀ đã chạy lại end-to-end qua DashScope thật
(không chỉ input giả lập) ở phiên 2026-07-31 — cả 3 hoạt động đúng như thiết kế.

**✅ Việc phát sinh (AppleDouble/`hyperframes lint`) đã xử lý xong** — xem chi tiết ở mục
"Phát hiện mới" bên trên: `.gitignore` chặn commit nhầm + `hyperframes-cli.mjs` tự dọn
`._*` trước mỗi lần lint/validate, đã test lại đúng kịch bản lỗi gốc và xác nhận hết.

**✅ Phase 2 (Backend API + job queue) đã xong VÀ đã test đủ cả 7 route qua HTTP thật**
— xem mục "Đã làm — Phase 2" bên trên, gồm cả full pipeline thật (`plan → audio →
video-plan → scene generate → render`) chạy tuần tự qua `curl`, sinh ra `.mp4` thật.
Phát hiện + vá 4 bug thật trong lúc test, quan trọng nhất là job thất bại từng bị ghi
nhầm "done" (đã sửa `runStep` kiểm tra `result.ok === false`).

**✅ Dọn `output/` rác đã xong (cùng phiên)**: `git rm --cached` (+ xoá trên đĩa) 3
project rác/test đã bị commit nhầm ở lần init đầu tiên —
`spotify-card-viral-tiktok` (chỉ có scaffold `hyperframes init`, chưa có nội dung gì),
`test-reorganize` (tên rõ ràng là project test, chỉ có scaffold), `e2e-chatgpt-5-phut`
(dùng schema cũ `plans.json`/`plans-with-timing.json` trước khi đổi tên thành
`scenes.json`/`scenes-with-timing.json` — không còn khớp code hiện tại). Xoá kèm 1 file
`.DS_Store` bị commit nhầm trong `cach-dung-claude-code-bien-mot-y-tuong-thanh-phan-/`.
Đã kiểm tra: 5 project còn lại trong `output/2026-05-16/` đều có nội dung thật (12–31
file, 1.9–4.4MB), không đụng vào. Thêm `.DS_Store` và `job-status.json` (runtime state
mới của Phase 2, không nên commit) vào `.gitignore`. **✅ Đã commit** (xem ghi chú cuối
file — đợt commit lớn `36a3d69` gộp toàn bộ Phase 2/3/root-composer/5 tính năng UI/dọn
rác, xác nhận lại bằng `git log`/`git status` sạch ở phiên sau).

**✅ Phase 3 (Frontend) đã xong VÀ đã test trong trình duyệt thật** — xem mục "Đã làm
— Phase 3" bên trên. Vite+React ở `web/`, đã chạy golden path thật qua Playwright
(headless Chromium): tạo project → content-planner qua DashScope → SSE cập nhật UI →
checkpoint review → preview iframe load được HyperFrames Studio thật. Phát hiện + vá 2
bug nghiêm trọng: `hyperframes preview --background` không tồn tại ở bản pin 0.6.12
(phải tự spawn detached + tree-kill), và proxy path-prefix cho preview không hoạt động
vì Studio dùng asset path tuyệt đối (đổi sang trả thẳng URL cổng riêng cho iframe).

**✅ Root-composer đã xong VÀ đã xác nhận chất lượng LLM thật** — user tự tay bấm
"Ghép video" → "Render" qua UI, quota DashScope đã hồi giữa phiên. Verify bằng
`ffprobe` (1920×1080, 14.85s, có cả video+audio stream) + trích 1 frame giữa video
bằng `ffmpeg` — xác nhận nội dung thật, đúng phong cách DESIGN.md (dark tech, neon
green), layout two-column rõ ràng, KHÔNG còn đen. Bug gốc (video đen do thiếu bước 6)
đã giải quyết triệt để, có bằng chứng hình ảnh, không chỉ tin `job-status`.

Trong lúc đó phát hiện + vá thêm 1 bug (`maxTurns` bị vượt do agent đọc lại dữ liệu
thừa — đã thêm hướng dẫn cấm + nâng giới hạn), và làm thêm 2 việc theo yêu cầu user:
model chọn được qua `.env` (`DASHSCOPE_MODEL`), và giữ hội thoại qua các vòng tự-sửa
lint để giảm token lãng phí (đã test bằng mock `fetch`, xác nhận không gửi lại skill
thừa).

**✅ 5 tính năng UI đã xong VÀ đã test qua Playwright thật** — xem mục "Đã làm — 5 tính
năng UI" bên trên: chọn project cũ, chọn ngang/dọc, layout full-width (vá 1 bug CSS
flex thật), xem video native trong UI, thống kê token per-step + tổng (test bằng 1 lần
gọi DashScope thật, hiện đúng số liệu).

Tất cả 4 Phase gốc (0/1/2/3) + 3 việc nhỏ + dọn rác + root-composer + 5 tính năng UI
đều đã xong và test thật bằng dữ liệu/tiến trình thật (không phải giả lập). Còn lại
duy nhất **Phase 4 — tích hợp ảnh AI** (chưa bắt đầu) — xem mục "Chưa làm" phía trên.

Thứ tự đề xuất cho phiên sau:
1. ~~Review + commit toàn bộ thay đổi đang pending~~ — **✅ đã commit** (`eb0f46b` →
   `36a3d69` → `c0abc2a`, xác nhận `git status` sạch sau khi pull). Không còn việc gì ở
   mục này.
2. Cân nhắc lại chi phí token thực tế (đã thảo luận với user — nhánh DashScope tốn hơn
   dự kiến ban đầu, ~50k token riêng bước ghép video cho 3 scene) — **✅ đã xử lý một
   phần**: đổi sang `qwen3.6-plus`/`qwen3.7-flash` (xem mục ngay dưới đây), nhưng chưa
   đo lại chi phí $ thật sau lần đổi model mới nhất này.
3. Phase 4 (ảnh AI)

---

## Cập nhật (phiên 2026-08-01, sau khi pull `36a3d69`+`c0abc2a`) — đối chiếu tài liệu vs thực tế

User đổi `.env` sang `DASHSCOPE_MODEL=qwen3.6-plus` / `DASHSCOPE_MODEL_CHEAP=qwen3.7-flash`
(khớp kết luận test ở mục "Cập nhật: đổi sang `qwen3.7-flash`" phía trên) và yêu cầu rà
lại xem `plan.md`/repo còn gì lệch thực tế không. Đối chiếu trực tiếp (`git log`,
`git status`, đọc file thật) thay vì chỉ tin nội dung `plan.md`, phát hiện 5 gap — cả 5
đều đã sửa trong phiên này:

1. **Phần "Quyết định tiếp theo" ở trên bị stale** — viết "CHƯA commit" trong khi
   `git status` đã sạch từ trước (việc commit đã xảy ra ở phiên khác, giữa lúc viết
   đoạn đó và lúc phiên này đọc lại). Đã sửa 2 đoạn liên quan ở trên (đánh dấu ✅/gạch
   ngang thay vì xoá, để giữ lại lịch sử quyết định).
2. **`.env.example` vẫn ghi default `qwen-plus`/`qwen-turbo`** dù `.env` thật + kết luận
   test trong file này đã chuyển sang `qwen3.6-plus`/`qwen3.7-flash` từ lâu — máy/phiên
   mới clone repo sẽ vô tình dùng lại model cũ, chậm/tốn hơn không cần thiết. Đã cập
   nhật default trong `.env.example` sang 2 model mới, giữ nguyên comment giải thích vai
   trò từng biến.
3. **`.env` thật thiếu hẳn `TTS_PROVIDER`** — không có dòng này, code tự rơi về default
   cứng `"elevenlabs"` trong `scripts/generate-audio.mjs`, nhưng ElevenLabs đã xác nhận
   bị chặn ở Free plan (402/401, xem mục Phase 0). Chạy audio thật (không phải test) mà
   quên set biến này mỗi lần gọi sẽ fail ngay từ dòng đầu. Đã thêm
   `TTS_PROVIDER=edge-tts` vào `.env` thật.
4. **`CLAUDE.md`/`AGENTS.md` không nhắc gì đến nhánh `server/`+`web/`** — đây là tài liệu
   workspace chính, tự động nạp vào context mọi phiên Claude Code, nhưng vẫn mô tả pipeline
   như thể chỉ có mỗi cách chạy qua Claude Code. Đã thêm 1 mục ngắn "Web UI thay thế
   (DashScope)" vào cả 2 file, trỏ sang `plan.md` để đọc chi tiết thay vì lặp lại nội
   dung.
5. **Không có `README.md` ở root; `web/README.md` vẫn là boilerplate Vite mặc định** —
   yêu cầu `npm install` trong `server/` và `web/` (bắt buộc, thiếu sẽ lỗi
   `ERR_MODULE_NOT_FOUND`) chưa từng nằm ở đâu dễ tìm. Đã tạo `README.md` ở root tóm tắt
   2 cách chạy (Claude Code / Web UI DashScope) + lệnh cài đặt, và viết lại
   `web/README.md` thay boilerplate.

Không phát hiện thêm sai lệch nào khác giữa `plan.md` và trạng thái thật của code/git
sau khi rà (đã kiểm tra: `.gitignore` đúng như mô tả, `output/` đã dọn đúng như mô tả,
toàn bộ file `server/`+`web/` khớp danh sách đã liệt kê).

---

## Đã sửa — 2 bug tốn token nghiêm trọng ở `run-agent.mjs` (phiên 2026-08-01, phát hiện
qua UI thật của user)

User tự tay generate `scene_01` của project `model-kimi-ra-doi-khien-claude-de-chung`
qua UI, thấy scene 4.85s tốn **90.197 token** (`prompt: 75.148 + completion: 15.049`) —
đặt câu hỏi hợp lý "có đúng không". Điều tra bằng dữ liệu thật (`job-status.json`), không
chỉ tin số liệu:

### Bug 1 — `reasoning_content` bị echo lại nguyên văn qua mọi turn/attempt

`qwen3.6-plus`/`qwen3.7-flash` là **reasoning model**, trả về `reasoning_content` (chuỗi
suy luận ẩn) trên mỗi assistant message. `run-agent.mjs` cũ làm `messages.push(message)`
— đẩy NGUYÊN VĂN message (kèm `reasoning_content`) vào lịch sử hội thoại, rồi lịch sử đó
được gửi lại đầy đủ ở mọi turn sau (và mọi attempt sau, qua `priorMessages`). Đo thật:
scene_01 sinh ra 26.771 ký tự (~6.700 token) reasoning qua 5 turn, bị echo lại nhiều lần
→ phần lớn trong 75k prompt token. Đây là anti-pattern đã biết với reasoning model (không
nên "đọc lại" scratchpad cũ của chính mình).

**Đã sửa**: `run-agent.mjs` giờ destructure bỏ `reasoning_content` trước khi
`messages.push(...)` — giữ nguyên trong event gửi cho `onEvent` (để debug/log), chỉ
không lưu vào lịch sử gửi lại API.

### Bug 2 — model gọi lặp `write_file` nhiều lần không dừng, dễ vượt `maxTurns`

Test lại ngay sau khi sửa bug 1 (trên `scene_02`, chưa generate) để đo hiệu quả — **tệ
hơn**: 184.005 token rồi **crash** vì vượt `maxTurns` (6), do model gọi `write_file` liền
**6 lần** trong 1 attempt mà không bao giờ tự dừng để báo "xong" (loop này KHÔNG phải do
bug 1 gây ra — cùng pattern đã có sẵn trong chính log `scene_01` trước khi sửa, chỉ nhẹ
hơn: 2 lần thay vì 6, do `scene_01` ít lỗi lint hơn nên "may mắn" không chạm trần). Kiểm
tra file để lại trên đĩa (đọc local, không tốn token): `compositions/scene_02.html` sau
lần ghi cuối (turn 5, trước khi crash) đã lint sạch (`0 errors, 0 warnings`) — tức model
đã xong việc từ sớm, chỉ tiếp tục gọi `write_file` thêm nhiều lần vô ích.

**Đã sửa (theo yêu cầu user)**: `run-agent.mjs` thêm param `stopAfterWrites` — dừng
attempt NGAY sau N lần `write_file` thành công đầu tiên, không đợi model tự quyết định
dừng. Nối vào `scene-writer.mjs` và `root-composer.mjs` (cả hai đều `stopAfterWrites: 1`,
cùng kiến trúc "chỉ ghi đúng 1 file/attempt", cùng rủi ro loop) — KHÔNG đụng
`content-planner.mjs`/`video-planner.mjs` (ghi nhiều file hơn 1, không có vòng retry,
chưa quan sát thấy triệu chứng này).

### Đã test lại thật, cả 2 fix cùng lúc — bằng chứng số liệu, không chỉ đọc code

Test trên `scene_03` (project thật, scene mới hoàn toàn): **PASS 2 attempt, 40.792
token** (`prompt: 25.626 + completion: 15.166`) — log xác nhận mỗi attempt dừng đúng
ngay sau 1 lần `write_file`, không còn gọi lặp. So với trước khi sửa: chưa bằng nửa chi
phí của `scene_01` (90.197) và không còn rủi ro crash như `scene_02` (184.005+lỗi). Lint
toàn project sau test vẫn `ok: true, 0 errors, 0 warnings`.

**Chi phí thật của việc điều tra + test**: ~274k token thật đã tốn trên tài khoản
DashScope của user trong quá trình chẩn đoán 2 bug này (90k của scene_01 gốc + 184k của
lần test scene_02 gây crash) — user đã chấp nhận đánh đổi này để có bằng chứng thật thay
vì chỉ sửa theo suy đoán.

### Thêm: hiển thị token + số lần gọi API trên UI (theo yêu cầu user, để dễ đối chiếu/debug)

- `run-agent.mjs` — `usage` giờ có thêm field `apiCalls` (đếm số lần gọi
  `chatCompletion`, không phải từ API trả về — tự đếm ở code). Số call cao bất thường tự
  nó là tín hiệu cảnh báo sớm cho đúng loại bug #2 ở trên, không cần đợi thấy số token.
- `job-status.mjs` + `useJobStatus.js` — cộng dồn `apiCalls` vào `totalUsage` (cả phía
  server lưu file lẫn phía client cộng dồn sống qua SSE), cùng cách đã làm với 3 field
  token trước đó.
- `TokenBadge.jsx` — hiện thêm "· N call" cạnh số token.
- `SceneGrid.jsx` — mỗi scene-card giờ có `TokenBadge` riêng (trước đó THIẾU — chỉ
  `StepRow` của 4 bước chính có, đúng gap đã nêu trong góp ý UI/UX trước đó) — đây là chỗ
  tốn token nhiều nhất (N scene × 1 lần gọi agent riêng) nên là chỗ cần hiện nhất.
- `Pipeline.jsx` — thêm "Tổng số lần gọi API" cạnh "Tổng token đã dùng" ở đầu trang.
- Đã build `web/` (`npx vite build`) xác nhận không lỗi JSX sau khi sửa.
