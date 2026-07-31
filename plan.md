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

## Chưa làm — theo đúng phân kỳ đã duyệt

### Phase 2 — Backend API + job queue (chưa bắt đầu)
- `server/jobs/queue.mjs` — hàng đợi trong-process, giới hạn concurrency theo provider
- `server/routes.mjs` — REST endpoint Express theo từng bước pipeline + SSE progress
  (`POST /projects`, `.../plan`, `.../audio`, `.../video-plan`,
  `.../scenes/:sceneId/generate`, `.../render`, `GET .../events`)
- State project vẫn là thư mục trên đĩa (tái dùng `output/YYYY-MM-DD/{slug}/video/`)
  + thêm 1 file `job-status.json` nhỏ theo dõi tiến độ

### Phase 3 — Frontend (chưa bắt đầu)
- Vite + React tối giản: form tạo project, stepper theo 6 bước có checkpoint review
  (`scenes.json`, `video-plan.json`), scene grid có preview + nút generate lại,
  progress realtime qua SSE
- Preview: proxy `npx hyperframes preview` chạy on-demand theo project, tự kill sau
  idle timeout

### Phase 4 — Tích hợp ảnh AI (chưa bắt đầu)
- `server/providers/image/dashscope-image.mjs` — DashScope image-gen (Tongyi
  Wanxiang/Qwen-Image), cố định style-prompt suffix (line-art/stick-figure) để nhất
  quán qua các scene
- `video-planner` cần thêm field `image_prompts` per scene khi style = "ảnh AI"
- `scene-writer` cần chèn `<img>` với `data-start/data-duration/data-track-index` theo
  đúng convention media hiện có

---

## Việc nhỏ nên làm khi quay lại (chưa làm, ghi chú để không quên)

- `video-planner.mjs` đang để model tự gọi `read_file` thừa 2 lần dù nội dung đã nhúng
  sẵn trong prompt — nên sửa system prompt để cấm việc này, tiết kiệm turn/token.
- Nên thêm 1 bước kiểm tra tĩnh (không cần LLM) sau `scene-writer`: regex flag các
  selector không animate được kiểu `::before`/`::after` trong `gsap.to/from` — bắt được
  đúng loại lỗi ngữ nghĩa đã gặp ở test này mà lint không bắt.
- Chưa có kiểm tra số học đơn giản cho `total_estimated_duration` (content-planner) và
  `total_duration` (video-planner) so với tổng các scene — có thể validate bằng code
  thường, không cần gọi LLM thêm.
- Các vấn đề review repo từ đầu phiên (không thuộc scope nhánh này, ghi lại cho đủ):
  `output/` có project test/trùng/legacy đã bị commit (`spotify-card-viral-tiktok`,
  `test-reorganize`, `e2e-chatgpt-5-phut` dùng schema cũ `plans.json`), và 1 file
  `.DS_Store` bị commit nhầm — chưa dọn.

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

Phase 0 + Phase 1 đã xong và validate thật — đây là phần rủi ro nhất (chất lượng
DashScope) và kết quả tốt. Việc còn lại (Phase 2/3/4) là công sức xây dựng thuần túy
(API, queue, UI), không còn ẩn số lớn về chất lượng. Phiên sau nên hỏi user muốn tiếp
tục theo đúng thứ tự Phase 2 → 3 → 4, hay ưu tiên xử lý danh sách "việc nhỏ nên làm"
ở trên trước.
