# Plan: Web UI fallback (DashScope + Edge TTS) khi hết credit Claude

## Mới — Banner "Đang chạy nền" trên UI (phiên 2026-08-02)

User hỏi Q&A: chạy xong video này muốn chạy luôn video khác trong lúc chờ thì sao.
Trả lời: backend đã hỗ trợ sẵn (mỗi step chạy `runInBackground` trên server, không
phụ thuộc browser có mở hay không; `queues.dashscope`/`queues.tts` giới hạn
concurrency DÙNG CHUNG toàn server nên nhiều project chạy cùng lúc tự xếp hàng an
toàn) — chỉ thiếu chỗ NHÌN THẤY project nào đang chạy khi không đứng nhìn nó. User
đồng ý làm thêm.

- `server/jobs/job-status.mjs` — `summarizeProjectStatus()` thêm field `isRunning`
  (boolean độc lập với `label`, vì thứ tự ưu tiên của label — lỗi > đã render > N/M
  scene > ... — có thể che mất trạng thái "đang chạy" thật, ví dụ 1 scene đang chạy
  vẫn hiện label "3/6 scene xong" chứ không phải "đang chạy").
- `web/src/components/RunningBanner.jsx` (mới) — poll `GET /projects` mỗi 6s (không
  dùng SSE vì `/events` chỉ scope theo 1 project, banner cần nhìn xuyên toàn bộ),
  lọc `isRunning === true` và khác project đang mở, hiện dải chip có thể bấm để nhảy
  sang project đó ngay (dùng lại `handleSelect` có sẵn trong `App.jsx`).
- Gắn `<RunningBanner>` ngay dưới header trong `App.jsx`, luôn hiện bất kể đang ở
  tab/project nào.
- Verify thật: gọi `/audio` lại trên 1 project đã render xong (`moi-tinh-dau-thoi-
  cap-3`) — confirm `GET /projects` trả đúng `isRunning: true` trong lúc chạy, quay
  về `false` sau khi xong. Xác nhận KHÔNG ảnh hưởng dữ liệu thật (audio step tự skip
  vì file đã tồn tại — convention có sẵn, `root`/`render` timestamp không đổi).

## Mới — Effect "Ken Burns" (zoom nhẹ ảnh nền, phiên 2026-08-02)

User hỏi khả thi zoom out 1 → 1.1 trên ảnh nền mỗi scene, không ảnh hưởng text/sub —
đã làm thành option trên UI, mặc định TẮT.

- `server/agents/video-planner.mjs` — param `kenBurns` (default `false`), ghi vào
  `plan.kenBurns` trong `video-plan.json` (chỉ khi `template === "sub"`, giống
  `imageLibrary`).
- `server/templates/sub-styles/image-full-focus.mjs` — `render({ kenBurns })` thêm
  1 dòng GSAP `tl.fromTo("#{prefix}-bg-image", {scale:1}, {scale:1.1, duration:
  sceneDuration, ease:"none"}, 0)` khi bật. Ảnh nền (`#{p}-bg-image`) là layer riêng,
  tách biệt hoàn toàn với `.{p}-shade`/`.{p}-text` (subtitle) nên 2 lớp đó không bị
  scale theo — đúng yêu cầu.
- `server/agents/sub-scene-writer.mjs`, `server/routes.mjs` — truyền `kenBurns` từ
  request → video-plan.json → style.render() theo đúng pattern đã có của
  `imageLibrary`/`fontFamily`.
- `server/lib/profiles.mjs` — thêm `kenBurns` vào `PROFILE_FIELDS` (lưu được theo
  channel profile).
- `web/src/components/Pipeline.jsx` — dropdown "Effect" (chỉ hiện khi `template ===
  "sub"`): "Không áp dụng (mặc định)" / "Ken Burns (zoom nhẹ 1 → 1.1)".
- Verify thật: bật `kenBurns=true`, regenerate `scene_01.html` của project thật
  (`tinh-yeu-tuoi-hoc-tro-that-trong-sang`) → confirm đúng dòng
  `tl.fromTo("#s1-bg-image", { scale: 1 }, { scale: 1.1, duration: 9.55, ease: "none" }, 0);`
  trong file, các tween chữ (`#s1-w0`...) không đổi. `npx hyperframes lint` không có
  lỗi mới phát sinh từ thay đổi này (1 lỗi `invalid_parent_traversal_in_asset_path`
  đang tồn tại từ trước, thuộc phần font `../assets/fonts/...`, không liên quan). Sau
  test đã revert lại project thật về đúng trạng thái ban đầu (xoá `kenBurns` khỏi
  `video-plan.json`, regenerate lại `scene_01.html` không có tween).
- Remix: `createRemixProject` copy nguyên `video-plan.json` nên `kenBurns` tự động
  giữ nguyên theo project gốc khi remix, không cần sửa thêm.

**Áp dụng cho video ĐÃ render xong trước đó** (user hỏi tiếp): route
`POST /projects/:id/video-plan/effects { kenBurns?, grain? }` — patch thẳng field(s)
vào `video-plan.json` đã có sẵn, KHÔNG gọi lại LLM (khác với bấm lại "Chạy
video-planner" sẽ tốn phí và có rủi ro model viết lại `visual_brief`/`image_tags`
khác đi). Chỉ patch field nào có mặt trong body — gọi riêng lẻ từng effect không cần
biết/gửi lại các field khác. UI: nút "Áp dụng vào video-plan đã có" cạnh 2 checkbox
Effect, chỉ hiện khi video-plan đã done. Sau khi bấm, user cần tự bấm "Generate" lại
từng scene trong SceneGrid (ảnh giữ nguyên nhờ skip-if-exists, chỉ HTML composition
được viết lại) rồi chạy lại Root + Render.

## Mới — Effect "Grain" (vết xước film nhẹ, phiên 2026-08-02)

User hỏi thêm về hiệu ứng tuyết rơi / vết xước nhẹ. Đề xuất: grain làm trước (rẻ,
universal, hợp mood hoài niệm của DESIGN.md), tuyết rơi để sau (nặng hơn — nhiều
particle động dễ đụng lint `timeline_track_too_dense` + tăng tải render, lại kén nội
dung theo mùa/mood) — user đồng ý chỉ làm grain trước.

- Đổi model effect từ 1 dropdown (chọn 1-trong-nhiều) sang **2 checkbox độc lập**
  (`kenBurns`, `grain`) vì 2 lớp không loại trừ nhau — có thể bật cả 2 cùng lúc.
- `image-full-focus.mjs` — `render({ grain })` thêm `<div class="{p}-grain">` (chỉ
  render khi bật) + CSS: SVG `feTurbulence` noise lặp lại (`background-repeat:
  repeat`), `mix-blend-mode: overlay`, `opacity: 0.12`, `z-index: 3` (trên cả
  subtitle), `pointer-events: none`. TĨNH (không animate) — không tốn gì thêm ở bước
  render capture, không cần asset/PNG texture ngoài, không đụng lớp ảnh/text.
- Wiring giống hệt pattern `kenBurns` xuyên suốt: `video-planner.mjs` (param `grain`
  → `plan.grain`), `sub-scene-writer.mjs`, `routes.mjs` (`/video-plan`,
  `/scenes/:id/generate`), `profiles.mjs` (`PROFILE_FIELDS`).
- Route patch-không-LLM đổi từ `/video-plan/ken-burns` → `/video-plan/effects` (nhận
  `{kenBurns?, grain?}`, generalize để chỉ cần 1 endpoint cho mọi effect tương lai
  thay vì thêm route riêng mỗi lần).
- Verify thật trên `tinh-yeu-tuoi-hoc-tro-that-trong-sang`: patch `grain:true` +
  regenerate scene_01 → xác nhận đúng `<div class="s1-grain">` xuất hiện trong HTML,
  CSS đúng noise/opacity. Patch lại `kenBurns:false, grain:false` + regenerate →
  confirm cả div lẫn tween zoom đều KHÔNG xuất hiện (chỉ còn CSS rule `.s1-grain`
  không dùng tới, vô hại — cùng kiểu với các class CSS luôn có sẵn khác trong style
  này). Project thật đã revert về đúng trạng thái sạch ban đầu sau test.

**BUG phát hiện sau khi user tự render thật** (phiên tiếp theo cùng ngày): user báo
render xong nhưng không thấy grain đâu cả. Root cause thật (verify bằng Playwright +
numpy pixel stats, KHÔNG phải do thiếu tải asset gì — grain là SVG data URI inline,
không phụ thuộc file/network):

- `mix-blend-mode: overlay` mà bản đầu dùng **gần như vô hiệu về toán học** trên nền
  rất sáng (pastel) hoặc rất tối — đúng chất liệu màu chủ đạo của DESIGN.md này (nền
  hồng nhạt phía trên, shade gần đen ở đáy). Verify: chụp screenshot layer grain qua
  Playwright trên nền đen thuần, đo bằng numpy — sau boost contrast 10x vẫn hoàn toàn
  đen, đúng công thức overlay (kết quả không đổi khi base gần 0 hoặc gần 1).
- **Fix**: bỏ hẳn `mix-blend-mode`, dùng alpha-blend thuần (`opacity: 0.08`, không
  blend-mode) — công thức này LUÔN có tác dụng bất kể độ sáng nền, vì nó chỉ là phép
  cộng tuyến tính `result = (1-α)×base + α×noise`.
- Verify lại bằng numpy đo std độ lệch pixel thật trên vùng nền pastel của frame đã
  render (qua nén H.264 thật, không phải screenshot tĩnh): std ≈ 17.5/255 — texture
  còn sống sót qua nén, không bị codec xoá mất (grain tần số cao thường bị H.264 làm
  mượt nếu quá yếu).
- Regenerate cả 6 scene + render lại toàn bộ (`video_2026-08-02_15-37-53.mp4`) —
  video thật của user giờ có grain hoạt động đúng, đã để nguyên state này (grain:
  true) vì đây chính là điều user đang cố làm, không phải dữ liệu test cần dọn.
- Bài học: mọi effect thị giác mới PHẢI verify bằng ảnh/video thật đã qua render +
  nén, không chỉ verify code có đúng cấu trúc HTML/CSS — 1 giá trị CSS hợp lệ về cú
  pháp vẫn có thể vô hiệu về mặt hiệu ứng thị giác tuỳ nền màu.

**BUG THỨ 2, nghiêm trọng hơn** (user báo tiếp: tích cả 2 checkbox, bấm "Lưu effect",
render lại vẫn "không thấy grain nào ?????"): std đo qua `hyperframes snapshot` (đúng
engine capture mà `render` dùng) cho thấy bật/tắt grain KHÔNG đổi gì cả (~17 cả 2
trường hợp) — số std ~17-18 đo được ở các lần verify TRƯỚC ĐÓ chỉ là nhiễu gradient tự
nhiên của chính ảnh AI, KHÔNG phải overlay CSS của tôi. Kết luận: bản đầu (bug #1
"overlay blend mode vô hiệu") che khuất 1 bug SÂU HƠN — **root cause thật**: HyperFrames'
compiler âm thầm bỏ qua `data:image/svg+xml` URI trong `background-image` hoàn toàn
(không lỗi, không cảnh báo). Verify bằng thử nghiệm đối chứng: inject cùng 1 CSS,
1 lần trỏ `data:` URI (std không đổi so với baseline), 1 lần trỏ 1 file PNG thật
(std tăng rõ 17→25, xác nhận bằng mắt qua `hyperframes snapshot`).

**Fix triệt để**: bỏ hẳn `data:` URI, tạo file texture noise thật (`assets/grain/
grain-texture.png`, PNG xám 256×256, sinh 1 lần bằng PIL, seed cố định — cùng
convention với `assets/fonts/`, `assets/music/`). `server/lib/grain.mjs` —
`ensureGrainCopied(projectDir)` copy file này vào `projectDir/assets/grain-texture.png`
(idempotent, giống `ensureFontCopied`). `sub-scene-writer.mjs` gọi hàm này khi
`grain: true`. `image-full-focus.mjs` CSS đổi sang `background-image: url("../assets/
grain-texture.png")`, bỏ `mix-blend-mode`, opacity 0.15 (alpha blend thuần).

Verify cuối: regenerate cả 6 scene + render toàn bộ thật
(`video_2026-08-02_16-02-42.mp4`) → xác nhận bằng ảnh (không chỉ số liệu) grain hiện
rõ mắt thường, đúng mức "nhẹ", sống sót qua nén H.264. Dọn AppleDouble junk sau test.

**Bài học quan trọng nhất rút ra từ 2 lần fix liên tiếp**: đo pixel std KHÔNG đủ để
verify 1 effect CSS có thật sự đến từ layer mình thêm — PHẢI có phép đối chứng ON/OFF
(bật/tắt effect, so sánh CÙNG vùng ảnh CÙNG composition) thay vì chỉ đo 1 lần rồi suy
diễn "có variance = effect hoạt động". Lần đầu tôi đo std=17.5 và kết luận nhầm là
"grain hoạt động, chỉ hơi yếu" — thực ra đó là nhiễu nền, effect chưa hề chạy.

## Mới — Grain CHUYỂN ĐỘNG (trôi + nhấp nháy, phiên 2026-08-02)

User hỏi tiếp (Q&A) nếu làm grain chuyển động (kiểu vết xước phim cũ) thì sao — đề
xuất 3 mức độ (trôi background-position / flicker opacity / vết xước dọc animate
riêng), user chọn làm 2 cái đầu (rẻ, không cần asset mới). Đã làm:

- `image-full-focus.mjs` — grain div giờ có `id="{p}-grain"`, 2 GSAP tween mới:
  1. `backgroundPosition` trôi từ `0px 0px` → `256px 256px` (đúng 1 chu kỳ tile,
     texture repeat nên trôi liền mạch không đứt đoạn) suốt `sceneDuration`, `ease:
     "none"`.
  2. Opacity nhấp nháy nhanh giữa base 0.15 và 0.20, `ease: "steps(1)"` (không mượt —
     đúng cảm giác "rung sáng" phim cũ), `yoyo: true`, `repeat: Math.ceil(sceneDuration
     / 0.14)` (tuân thủ quy tắc không dùng `repeat: -1`).
- Verify thật: regenerate cả 6 scene, xác nhận đúng 2 dòng tween trong composition;
  render toàn bộ (`video_2026-08-02_19-38-18.mp4`); trích 2 frame cách nhau 0.3s, so
  sánh pixel-diff bằng numpy → mean diff 4.76/255, max 32 trong vùng lấy mẫu — xác
  nhận grain THẬT SỰ đổi giữa các frame (trước đây static, diff sẽ ~0 nếu không đổi).

---

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

### ✅ Phase 4 — Tích hợp ảnh AI: phần core đã xong + verify thật (phiên 2026-08-01)

Model dùng: **`wan2.6-image`** (theo yêu cầu user). API contract KHÔNG tự đoán — tìm qua
`WebSearch`/`WebFetch` docs Alibaba Cloud, rồi xác nhận lại bằng gọi API thật (endpoint
tài liệu ghi cần `{WorkspaceId}` subdomain, nhưng thử domain `dashscope-intl.aliyuncs.com`
đã dùng cho chat completions thì THÀNH CÔNG luôn, không cần workspace subdomain — tiết
kiệm 1 bước tra cứu thêm).

**API contract thật (khác vài chỗ so với docs, đã tự dò qua chuỗi lỗi thật)**:
- Endpoint: `POST https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`
  (native DashScope, KHÔNG phải OpenAI-compatible)
- Text-to-image thuần (không có ảnh input) BẮT BUỘC `enable_interleave: true`
- `enable_interleave: true` BẮT BUỘC `stream: true` + header `X-DashScope-SSE: enable`
  — request non-streaming bị từ chối thẳng
- Response là SSE: model trả TEXT commentary từng chunk TRƯỚC, ảnh là chunk `{type:
  "image"}` cuối cùng — phải đọc hết stream, không lấy chunk đầu
- `size` dạng `"<số>*<số>"` — tài liệu ghi "H*W format" nhưng test thật xác nhận SỐ ĐẦU
  = width ảnh ra (ngược với tên gọi tài liệu) — tổng pixel phải trong khoảng
  [589824, 1638400] khi `enable_interleave=true`. Đã tính sẵn 2 size khớp đúng tỉ lệ:
  9:16 → `"864*1536"`, 16:9 → `"1536*864"`
- URL ảnh trả về ký OSS, hết hạn 24h — phải tải về ngay, không lưu URL lại dùng sau
- Positive prompt "no watermark, no text" KHÔNG đủ tin cậy — test thật ra ảnh có
  watermark nhỏ ở góc dù đã ghi rõ trong prompt. Phải dùng riêng `negative_prompt`
  (param khác, hiệu quả hơn hẳn) — test lại xác nhận hết watermark.

**Đã làm**:
- `server/providers/image/dashscope-image.mjs` — `generateImage()` (gọi API, tự parse
  SSE, trả URL) + `generateAndSaveImage()` (gọi + tải về đĩa ngay, vì URL hết hạn 24h)
- `video-planner.mjs` — thêm param `visualStyle` ("animation" mặc định, không đổi hành
  vi cũ | "ai-image"). Khi "ai-image", override prompt yêu cầu thêm field `image_prompt`
  mỗi scene: mô tả đúng theo DESIGN.md (model tự đọc, không hardcode màu/style), không
  chữ/watermark trong ảnh, chừa negative space cho text overlay, DÙNG CHUNG 1 style
  clause cho mọi scene trong video (chỉ đổi chủ thể) để nhất quán — vì đây là 1 lần gọi
  duy nhất thấy hết mọi scene, giữ nhất quán dễ hơn để mỗi scene-writer tự quyết riêng lẻ
- `scene-writer.mjs` — nếu `scene.image_prompt` tồn tại: tải ảnh về
  `assets/images/scene_NN.png` NGAY TRƯỚC KHI gọi agent (không phải để model tự gọi tool
  giữa chừng — tránh model phải chờ/retry 1 call chậm bên trong turn budget của nó), rồi
  chèn hướng dẫn bắt buộc vào prompt: `<img>` đứng ĐẦU TIÊN trong DOM, `data-track-index=
  "0"` riêng, `position:absolute;inset:0;object-fit:cover;z-index:0`, content chữ đè lên
  với `z-index` cao hơn, KHÔNG tự vẽ thêm atmosphere layer (dot-grid/glow) đè lên ảnh

**Đã test end-to-end thật** (project scratch, chủ đề "Claude Code" cũ đã có sẵn
`DESIGN.md`+`scenes-with-timing.json`):
- `video-planner` với `visualStyle=ai-image`: viết đúng 5 `image_prompt`, style nhất
  quán y hệt nhau across scene ("dark tech aesthetic with neon green accent, no text, no
  words, no watermark"), mỗi scene mô tả khác nhau đúng theo `content_shape` riêng (2
  panel trống cho two-column, radial glow cho spotlight, 3 slot cho checklist...)
- `scene-writer` cho `scene_01` (ai-image): PASS sau 3 attempt, ảnh tải về đúng
  864×1536 (đúng 9:16), `<img>` chèn đúng mọi thuộc tính bắt buộc
- **Phát hiện + verify bằng mắt, KHÔNG chỉ tin lint pass**: file `scene_01.html` model
  viết ra là 1 HTML document đầy đủ (`<!doctype html>...`), KHÔNG bọc `<template>` như
  convention sub-composition — khác mọi file trước đó trong phiên. `hyperframes lint`
  KHÔNG bắt được điều này (giống 2 bug trước — lint không kiểm cấu trúc `<template>`).
  Build 1 root tối giản + render thật để kiểm tra thay vì tin lint: **render ra ĐÚNG**,
  ảnh nền + 2 card chữ chồng lên nhau chính xác, không lệch, không đen — tức framework
  vẫn load được sub-composition dù thiếu `<template>` (ít nhất ở bản CLI 0.6.12 này).
  Chưa sửa/ép buộc lại `<template>` vì THỰC TẾ vẫn render đúng — ghi lại để biết, không
  phải bug chặn, nhưng nên theo dõi nếu gặp lại ở scene khác.
- Ảnh render ra khớp gần như hoàn hảo với layout chữ đè lên (2 tấm neon xanh trong ảnh
  trùng đúng vị trí 2 card chứa số liệu) — chất lượng vượt kỳ vọng ban đầu.

**Chưa làm** (còn lại của Phase 4, không chặn việc dùng thử qua CLI/test script):
- Chưa test `root-composer` với scene có ảnh (chỉ mới test 1 scene độc lập, chưa ghép
  nhiều scene ai-image vào 1 video hoàn chỉnh qua root thật).
- Chưa xử lý trường hợp `generateAndSaveImage` lỗi giữa chừng (API down, quota hết) —
  hiện lỗi sẽ ném thẳng ra ngoài, làm cả scene fail, chưa có fallback về animation thuần.

**✅ Đã nối `visualStyle` vào UI (phiên 2026-08-01, tiếp theo)**: đặt selector ở đúng
bước 3 "Video plan" trong `Pipeline.jsx` (không phải lúc tạo project) — vì `visualStyle`
chỉ thực sự cần tại thời điểm gọi `runVideoPlanner`, và project hiện không có file
meta nào sống qua nhiều bước để giữ lựa chọn từ lúc tạo tới lúc chạy video-planner (khác
`platform`, vốn đã đi thẳng vào `hyperframes init --resolution` ngay tại bước tạo). Theo
đúng pattern đã có sẵn của `ttsProvider` (chọn ngay tại bước Audio, không phải lúc tạo
project). Đường đi: `Pipeline.jsx` state `visualStyle` → `api.runVideoPlan(id, {
visualStyle })` → `POST /projects/:id/video-plan` body → `routes.mjs` destructure →
`runVideoPlanner({ visualStyle })`. Không cần gọi DashScope thật để verify phần này —
`runVideoPlanner`'s `visualStyle="ai-image"` logic đã verify sống ở mục trên rồi, đây
chỉ là plumbing tham số qua HTTP; verify bằng lint (`oxlint` sạch) + `node --check
routes.mjs`.

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

---

## Đã sửa — video-planner timeout: DashScope bị abort sau đúng 90s × 3 lần (phiên 2026-08-01)

User báo lỗi thật qua UI khi dùng style "animation thuần" (không phải ai-image):
`DashScope chat completion failed after 3 attempt(s): This operation was aborted`, xảy
ra ở bước 3 (Video plan). `job-status.json` của project
`output/2026-08-01/con-nguoi-ngay-cang-le-thuoc-nhieu-vao-ai/video` cho thấy user đã
retry 3 lần, mỗi lần đúng ~4m33s trước khi báo lỗi.

### Root cause

`4m33s ≈ 90s + 90s + 90s + 1s + 2s` (2 backoff giữa 3 attempt) — khớp chính xác với
`chatCompletion()` cũ (`server/providers/llm/dashscope.mjs`) dùng `timeoutMs = 90_000,
retries = 2` mặc định. Cả 3 attempt đều bị `AbortController` tự hủy đúng ở mốc 90s,
KHÔNG phải lỗi network tức thời (ECONNRESET/transient) — nghĩa là DashScope vẫn đang
generate, chỉ là chưa xong trong 90s. `video-plan.json` là task nặng nhất pipeline:
model `qwen3.6-plus` (reasoning) phải viết `visual_brief` chi tiết + `elements` +
`sfx_picks` cho 8 scene trong 1 lần gọi — nặng hơn hẳn `content-planner` (chỉ 2 file
ngắn, xong trong 35s cùng project này).

### Fix

- `dashscope.mjs`: bump `timeoutMs` mặc định 90_000 → 180_000.
- `run-agent.mjs`: thêm param `timeoutMs` optional, forward xuống `chatCompletion`.
- `video-planner.mjs`: set riêng `timeoutMs: 240_000` (dư hẳn so với global default) vì
  đây là task nặng nhất, chỉ chạy 1 lần/video nên timeout dài hơn không tốn thêm chi
  phí, chỉ tốn thời gian chờ khi thật sự cần.

### Verify thật — không chỉ sửa code rồi đoán

Chạy lại ĐÚNG project + ĐÚNG lệnh đã fail (`node --env-file=.env
server/agents/test-video-planner.mjs <projectDir> animation`, model thật
`qwen3.6-plus`, không mock) — thành công ngay ở turn đầu, `video-plan.json` sinh ra 8
scene, `format: "9:16"` khớp project. Request y hệt trước đây bị abort 3 lần liên tiếp
ở 90s giờ hoàn tất gọn trong 1 attempt với timeout mới.

---

## Đã sửa — Render kẹt mãi "Đang chạy…" sau khi restart server (phiên 2026-08-01)

User báo qua UI: bước Render bấm chạy rồi đứng yên "Đang chạy…" không bao giờ xong,
nút Render cũng biến mất (bị ẩn khi `status === "running"`) nên không bấm lại được.

### Root cause (2 lỗi cộng lại)

1. `job-status.json` không có cơ chế phục hồi: state sống hoàn toàn trên đĩa, nhưng
   `"running"` chỉ có nghĩa "một tiến trình NÀO ĐÓ đang làm việc này" — nếu tiến trình
   đó chết (crash, hoặc user restart server để nạp code mới, đúng như hướng dẫn tôi
   đưa ở mục fix timeout phía trên) thì không còn ai gọi `emitProgress` "done"/"error"
   nữa, entry "running" tồn tại vĩnh viễn trên đĩa.
2. `render()` trong `hyperframes-cli.mjs` gọi `execFile` KHÔNG có `timeout` — nếu tiến
   trình `hyperframes render` con bị treo thật (không phải do restart) thì cũng đứng
   yên vô thời hạn, không có giới hạn nào.

Xác nhận thật: PID server cũ (10020, khởi động 9:40 sáng) đã không còn tồn tại khi
kiểm tra lúc 17:02 chiều — server đã bị restart (theo đúng chỉ dẫn của tôi ở fix
trước), nhưng `job-status.json` của project
`con-nguoi-ngay-cang-le-thuoc-nhieu-vao-ai` vẫn ghi `render: running` từ lúc 9:43
sáng, đứng yên hơn 7 tiếng.

### Fix

- `job-status.mjs`: thêm `reconcileInterruptedSteps(projectDir)` — quét mọi step
  đang `"running"`, chuyển thành `"error"` kèm thông báo rõ ràng ("Bị gián đoạn do
  server khởi động lại giữa chừng").
- `index.mjs`: gọi hàm trên cho MỌI project (`listProjects()`) ngay lúc server khởi
  động, trước khi lắng nghe request.
- `hyperframes-cli.mjs`: `render()` thêm `timeout: 10 phút` (override qua
  `RENDER_TIMEOUT_MS`) — chặn luôn trường hợp treo thật trong lúc server vẫn sống,
  không chỉ trường hợp restart.

### Verify thật

Gọi thẳng `reconcileInterruptedSteps()` trên ĐÚNG project bị kẹt (không mock) —
xác nhận `render` chuyển từ `"running"` (đứng từ 9:43 sáng) sang `"error"` kèm thông
báo, tức nút Render sẽ hiện lại đúng như thiết kế UI (`renderStatus !== "running"`).
Việc chạy lại toàn bộ render thật (để tạo `.mp4`) chưa làm ở đây — cần user tự bấm lại
qua UI sau khi restart server.

---

## Mới — Style "Sub karaoke" (`template: "sub"`), tách biệt hoàn toàn khỏi luồng animation (phiên 2026-08-01)

User muốn 1 luồng thứ 3, KHÔNG phối với `visualStyle` hiện có ("animation"/"ai-image"),
tham khảo trực tiếp 2 file mẫu trong repo `Pixelle-Video`
(`data/templates/1080x1920/image_full_focus.html`, `image_pastel_minimal.html`): ảnh
AI full-bleed làm nền + 1 khối phụ đề tĩnh gần đáy — đơn giản hơn nhiều so với
`scene-writer` hiện tại (không có `data-start/data-duration/GSAP timeline`, chỉ là
template `{{placeholder}}` tĩnh). Yêu cầu: giữ đúng tinh thần layout đó, nhưng THÊM
timing — chữ sáng lên đúng lúc được nói (karaoke), dùng `word_timestamps` thật đã có
sẵn từ bước audio.

### Quyết định kiến trúc quan trọng nhất: **bỏ hẳn LLM cho bước viết composition**

Khác với `scene-writer.mjs` (agent gọi DashScope để viết HTML sáng tạo mỗi scene),
style "sub" sinh HTML **thẳng bằng code**, không qua `runAgent` — vì mọi giá trị cần
(đường dẫn ảnh, thời điểm từng từ, kích thước canvas) đều đã có sẵn từ dữ liệu, không
có gì cần model "quyết định". Lợi ích thật, không phải lý thuyết: rẻ hơn (0 token cho
bước này), nhanh hơn (không chờ DashScope), và không thể dính lại các lớp bug đã gặp
trước đó (LLM viết sai `.clip`, sai kích thước canvas...) vì không có LLM viết HTML
nữa — chỉ còn 1 lệnh gọi DashScope thật cho mỗi scene: sinh ảnh nền (`wan2.6-image`,
provider có sẵn từ Phase 4).

### File mới

- `server/templates/sub-styles/image-full-focus.mjs` — port từ
  `image_full_focus.html` của Pixelle-Video, viết lại theo convention HyperFrames.
  Ảnh nền vẫn `class="clip" data-start/data-duration` (time-gated, giống scene-writer's
  ai-image), nhưng mỗi từ phụ đề là `<span>` KHÔNG có `class="clip"` — vì không ẩn/hiện
  theo thời gian (luôn hiện suốt scene), chỉ đổi màu (karaoke highlight) qua GSAP
  `.to()` tại đúng `word.start`/`word.end` — CLAUDE.md's "element có timing phải
  class=clip" chỉ áp dụng cho hiện/ẩn, không áp dụng cho tween màu thuần. Font size,
  padding, chiều cao dải gradient... tính theo % kích thước canvas (không hardcode
  1080×1920 như bản gốc Pixelle) để dùng chung được cho cả 9:16 lẫn 16:9.
- `server/templates/sub-styles/index.mjs` — registry `{styleKey: renderModule}` — thêm
  style mới sau này (user tự nói "image_full_focus chỉ là 1 style tôi muốn") chỉ cần 1
  file + 1 dòng đăng ký, không đụng gì tới sub-scene-writer.mjs.
- `server/agents/sub-scene-writer.mjs` — hàm thay thế `scene-writer.mjs` khi
  `template === "sub"`: gọi `generateAndSaveImage` (ảnh AI thật) rồi render template
  thẳng bằng code, ghi file, lint để bắt lỗi cấu trúc còn sót (dù không có LLM viết,
  vẫn lint để chắc chắn — verify thật cho thấy 0 lỗi).
- `server/agents/test-sub-scene-writer.mjs` — script test độc lập, giống
  `test-scene-writer.mjs` nhưng cho luồng mới.

### Nối dây (routes.mjs / video-planner.mjs / UI)

- `video-planner.mjs`: thêm `template` ("motion" mặc định | "sub") + `subStyle`. Khi
  `template === "sub"`, ÉP `visualStyle = "ai-image"` bên trong (sub luôn cần ảnh AI,
  không để 2 tham số này lỡ mâu thuẫn nếu caller quên đồng bộ). Sau khi model viết
  xong `video-plan.json`, **code tự ghi đè thêm field `template`/`subStyle` vào file**
  — KHÔNG dựa vào model tự nhớ echo lại đúng giá trị (đúng bài học từ mọi bug trước:
  đừng tin LLM giữ đúng 1 giá trị cấu trúc xuyên suốt).
- `routes.mjs` (`POST /projects/:id/scenes/:sceneId/generate`): đọc
  `videoPlan.template` — nếu `"sub"` thì đọc thêm `scenes-with-timing.json` (để lấy
  `narration` + `_audio.word_timestamps`, 2 field này KHÔNG có trong `video-plan.json`
  — đã xác nhận bằng cách đọc file thật) rồi gọi `runSubSceneWriter`; ngược lại giữ
  nguyên `runSceneWriter` như cũ. `root-composer` KHÔNG cần sửa gì — nó đã đối xử với
  mọi `compositions/scene_XX.html` một cách generic (chỉ cần đúng
  `id/data-composition-id/timeline registration`), đã verify điều này đúng từ Phase 4.
- UI (`Pipeline.jsx`, bước 3): thêm select "Kiểu video" (`template`) — "Chuyển động
  (card/animation)" | "Sub karaoke (ảnh AI + phụ đề chạy chữ)". Chọn "Chuyển động" thì
  hiện lại select `visualStyle` cũ; chọn "Sub karaoke" thì hiện select `subStyle`
  (hiện chỉ có "Full Focus", registry sẽ phình thêm sau).

### Verify thật — toàn bộ pipeline mới, không chỉ đọc code

1. `test-video-planner.mjs <scratchProject> animation sub` (gọi DashScope thật,
   `qwen3.6-plus`) — xác nhận `video-plan.json` có đúng `template: "sub"`,
   `subStyle: "image_full_focus"`, và mỗi scene có `image_prompt`.
2. `test-sub-scene-writer.mjs <scratchProject> scene_01` — gọi `wan2.6-image` thật sinh
   ảnh + ghi HTML — PASS, lint 0 lỗi.
3. `hyperframes render` thật trên project (đã có root từ Phase 4) → render ra
   `.mp4` thành công (8.39s, 252 frame).
4. Trích frame thật bằng `ffmpeg` ở 3 mốc (0.5s / 4.0s / 7.5s) và XEM bằng mắt (không
   chỉ tin render "complete"): t=0.5s từ "đang" sáng màu cam đúng lúc; t=4.0s không từ
   nào sáng (đang ở khoảng lặng giữa 2 từ — xác nhận timing thật, không phải luôn sáng
   1 màu cố định); t=7.5s từ cuối "custom" sáng đúng lúc kết câu. Ảnh nền AI, dải
   gradient, layout khớp hệt bản Pixelle gốc.

### Chưa làm / biết trước

- Chưa test `root-composer` (LLM) tự động ghép NHIỀU scene "sub" vào 1 root hoàn
  chỉnh qua UI thật — mới verify bằng root dựng tay cho 1 scene. Tin tưởng cao vì
  root-composer đã verify generic hóa từ Phase 4, nhưng chưa có bằng chứng trực tiếp
  cho style này.
- `video-planner` vẫn sinh đủ `visual_brief`/`elements` cho style "sub" dù không dùng
  tới (chỉ cần `image_prompt`) — lãng phí nhẹ (prompt/output dài hơn cần thiết) nhưng
  không sửa vì không muốn đụng vào schema SKILL.md đã test kỹ, rủi ro cao hơn lợi ích
  ở quy mô hiện tại.
- Ghép từ chưa có dấu câu (word_timestamps không có token dấu câu riêng) — phụ đề hiện
  đọc liền mạch không chấm/phẩy, chỉ là vấn đề thẩm mỹ nhỏ, chưa xử lý.
- Style thứ 2 (Pastel Minimal hoặc khác) — registry đã sẵn sàng nhận thêm, chưa viết.

---

## Đánh giá — đối chiếu setup options của Pixelle-Video, việc gì nên làm tiếp (phiên 2026-08-01)

User hỏi (chưa code, chỉ thảo luận): Pixelle-Video có nhiều bước setup hơn hẳn — chọn
template HTML, model tạo ảnh, số scene, prefix prompt tạo ảnh, prefix prompt tạo kịch
bản — có nên mang hết sang không? Đã đọc thật `pixelle_video/config/schema.py` +
`web/pipelines/standard.py` của Pixelle-Video (không đoán) để đối chiếu, kết luận:

| Mục Pixelle-Video | Đánh giá |
|---|---|
| Chọn template HTML | Đã có (`subStyle` dropdown, xem mục "Sub karaoke" phía trên) — mở rộng chỉ cần thêm file registry |
| Model tạo ảnh | Đã có (`DASHSCOPE_MODEL_IMAGE` — xem mục ngay trên) |
| Số scene (`n_scenes`, chọn TRƯỚC khi generate) | **Không nên copy** — mâu thuẫn triết lý content hiện tại. Pixelle chọn N trước rồi ép nội dung vừa N. Repo này (CLAUDE.md) cắt cảnh theo Ý NGHĨA — "mỗi cảnh 5-15s, một ý, một cảm xúc" — KHÔNG theo số cố định. Áp N cứng sẽ ép câu chuyện co giãn cho vừa số, ngược hướng đang làm. |
| Prefix prompt tạo ảnh (Pixelle: `comfyui.image.prompt_prefix`, mặc định "Minimalist black-and-white matchstick figure style...") | **Đáng làm nhất** — hiện `image_prompt` mỗi scene hoàn toàn do LLM tự quyết phong cách (anime/minimal/...) dựa trên DESIGN.md, chưa có cách user chỉnh nhanh mà không sửa DESIGN.md. Tận dụng đúng cơ chế "style clause dùng chung" đã có sẵn trong `video-planner.mjs`'s `imageStyleOverride` (dòng "DÙNG CHUNG 1 cụm mô tả phong cách... ở cuối MỌI prompt") — chỉ cần cho user override cụm đó thay vì để model tự nghĩ. |
| Prefix prompt tạo kịch bản | Có thể làm — nhưng đã có field `audience` truyền vào `content-planner` đóng vai trò gần tương tự. Nếu làm, nên là field "ghi chú phong cách" TỰ DO, bổ sung chứ không thay `audience`. |

### Việc nên làm ở phiên sau (chưa code, đã thống nhất hướng)

1. **Prefix prompt tạo ảnh** — field mới (tên đề xuất: `imageStylePrefix`), truyền qua
   route `/video-plan` giống `template`/`subStyle`/`visualStyle` hiện tại, inject vào
   `imageStyleOverride` trong `video-planner.mjs` (thay vì để model tự bịa style
   clause, dùng đúng chuỗi user nhập). Áp dụng cho CẢ 2 luồng `visualStyle: "ai-image"`
   VÀ `template: "sub"` vì cả hai đều dùng chung field `image_prompt`.
2. **Prefix/ghi chú phong cách kịch bản** — field tự do mới trong bước 1 (Content
   plan), truyền vào `content-planner.mjs` bên cạnh `audience` hiện có, không thay thế.
3. Không làm "chọn số scene cố định trước" — đã quyết định loại khỏi scope, ghi lại ở
   đây để phiên sau không lặp lại câu hỏi này từ đầu.

UI: cả 2 field mới nên là input text tùy chọn (không bắt buộc), đặt cạnh dropdown
template/visualStyle tương ứng ở Pipeline.jsx bước 1 và bước 3.

---

## Đã làm — 4 fix theo yêu cầu user (phiên 2026-08-01, sau khi user gửi screenshot bug thật)

User gửi screenshot 1 video "sub" đã render: caption hiện **3 dòng cùng lúc** (dồn hết
narration vào 1 khối), yêu cầu 4 việc. Có tham khảo thật `Pixelle-Video-andtptit` (repo
đã có sẵn local ở `/Volumes/New Volume/GITHUB/Pixelle-Video-andtptit`) theo đúng yêu cầu.

### 1. `imageStylePrefix` — mặc định "minimal" theo đúng Pixelle-Video

Đọc thật `pixelle_video/config/schema.py` — lấy đúng nguyên văn default gốc:
`"Minimalist black-and-white matchstick figure style illustration, clean lines, simple
sketch style"`. `video-planner.mjs` giờ nhận `imageStylePrefix` (default = chuỗi trên),
BẮT BUỘC model dùng ĐÚNG NGUYÊN VĂN cụm này ở cuối mọi `image_prompt` (thay vì để model
tự nghĩ 1 cụm và tự nhớ giữ nhất quán — đúng bài học cũ "đừng tin LLM giữ đúng 1 giá trị
cấu trúc xuyên suốt"). **Đã test thật qua DashScope**: tạo project scratch, chạy
`test-video-planner.mjs` với `imageStylePrefix` tuỳ chỉnh — xác nhận cả 4 scene đều kết
thúc `image_prompt` bằng ĐÚNG NGUYÊN VĂN cụm truyền vào, chỉ phần composition đổi theo
scene. Route `/video-plan` + UI (ô input cạnh dropdown template/visualStyle) đã nối dây.

### 2. Font viết tay hỗ trợ tiếng Việt — xác nhận thật qua Google Fonts API, không đoán

Kiểm tra hàng loạt ứng viên qua `fonts.google.com/metadata/fonts/<tên>` (field
`coverage.vietnamese`), TỪNG FONT MỘT (batch request đầu bị rate-limit cho kết quả sai,
đã phát hiện và làm lại cẩn thận). Kết quả:
- **CÓ** tiếng Việt: Itim, Mali (đã có từ trước), + phát hiện thêm Sriracha, Charm,
  Pacifico, Amatic SC, Baloo 2, Be Vietnam Pro (2 cái sau không phải kiểu viết tay)
- **KHÔNG** có tiếng Việt (dù rất phổ biến, dễ bị chọn nhầm nếu không kiểm tra thật):
  Caveat, Kalam, Patrick Hand, Permanent Marker, Gochi Hand, Indie Flower, Dekko,
  Shadows Into Light, Coming Soon, Neucha, Nanum Pen Script, và nhiều font khác

Cập nhật `DESIGN-healing.md` với 6 lựa chọn đã xác nhận (Itim mặc định). Quan trọng
hơn: phát hiện **`image-full-focus.mjs` đang hardcode "Baloo 2"/"Be Vietnam Pro"** —
2 font này (giờ xác nhận) THỰC RA có hỗ trợ tiếng Việt nên không phải bug hiển thị, NHƯNG
không phải font viết tay, không khớp mood ảnh mẫu user gửi. Đã sửa thành field
`fontFamily` cấu hình được (mặc định `Itim`), đăng ký trong `FONT_WEIGHTS` map — thêm
font mới chỉ cần 1 dòng.

### 3. Tách phụ đề thành từng câu ngắn — bug thật đã sửa, phát hiện thêm 1 bug khi test

`server/lib/caption-chunks.mjs` (mới) — `chunkWords(words, narration, {maxWordsPerChunk})`:
ưu tiên tách theo ranh giới CÂU thật lấy từ `narration` (có dấu câu; `word_timestamps`
thì không — xác nhận qua đọc dữ liệu thật), nếu tổng số từ theo câu KHỚP số lượng
`word_timestamps` thì dùng cách này; nếu không khớp (fallback an toàn) thì chia đều theo
`maxWordsPerChunk` (mặc định 6 từ/chunk). Câu dài không dấu câu vẫn bị chia nhỏ tiếp.

`image-full-focus.mjs` giờ render NHIỀU `<div class="clip">` (1 mỗi chunk) thay vì 1 khối
chứa hết mọi từ — mỗi chunk có `data-start`/`data-duration` đúng khung [từ đầu bắt đầu,
từ cuối kết thúc], cơ chế `class="clip"` của HyperFrames tự ẩn/hiện đúng lúc, không cần
thêm GSAP cho phần hiện/ẩn (chỉ còn cần cho tween đổi màu karaoke như cũ).

**Bug phát hiện khi test bằng dữ liệu thật** (narration nhiều câu sát nhau): buffer
+0.3s cộng vào cuối mỗi chunk để "không biến mất ngay khi dứt lời" đôi khi VƯỢT QUA thời
điểm chunk kế tiếp bắt đầu → 2 chunk hiện chồng lên nhau — đúng lại y hệt vấn đề đang
sửa. Đã vá: cap buffer tại `min(chunk.end + 0.3, nextChunk.start - 0.05)`.

**Verify bằng render thật** (không chỉ đọc code): ghi đè `scene_01.html` của project
thật `su-im-lang-doc-hai-se-giet-chet-dan-moi-quan-he` (đúng project tạo ra screenshot
bug gốc), lint 0 lỗi (1 warning không đáng ngại), render ra `.mp4` thật, trích 2 frame
bằng `ffmpeg` ở t=0.5s và t=3.5s — xác nhận: chỉ 1 dòng caption hiện tại 1 thời điểm
(trước đó là 3 dòng), karaoke highlight đúng từ, dấu tiếng Việt hiển thị đầy đủ với font
Itim mới.

### 4. Tốc độ Edge TTS — mặc định 1.1, xác nhận thật bằng đo thời lượng file

`msedge-tts`'s `ProsodyOptions.rate` nhận number tương đối trực tiếp (xác nhận qua đọc
`.d.ts` của thư viện) — không cần convert sang chuỗi `"+10%"`. `edge-tts.mjs` thêm param
`rate` (default `EDGE_TTS_RATE` env hoặc 1.1), truyền vào `tts.toStream(text, {rate})`.
**Test thật**: tổng hợp cùng 1 câu ở rate 1.0/1.1/1.3 → thời lượng 2.85s/2.60s/2.20s,
giảm đúng tỉ lệ nghịch với rate — xác nhận hoạt động, không chỉ tin theo doc thư viện.
Nối qua `generate-audio.mjs` (`ttsRate` option, chỉ ảnh hưởng edge-tts — truyền vào
elevenlabs.mjs vô hại vì hàm đó không có param này) → `routes.mjs` (`POST /audio`) →
UI (ô số cạnh dropdown provider, chỉ hiện khi chọn edge-tts, mặc định 1.1).

### Việc phụ (đồng bộ theo convention đã có)

- `plan.template = template` pattern (code ghi, không tin model) áp dụng luôn cho
  `fontFamily` — ghi vào `video-plan.json` ở bước video-plan, đọc lại ở bước generate
  scene, để mọi scene trong cùng video dùng nhất quán 1 font không cần truyền lại mỗi lần.
- Cập nhật đồng bộ 2 CLI test script (`test-video-planner.mjs`, `test-sub-scene-writer.mjs`)
  theo tham số mới, giữ đúng thói quen đã có từ đầu dự án.

### Chưa làm / biết trước
- Chưa test `imageStylePrefix` + `fontFamily` cùng lúc qua route thật (`POST
  /video-plan` qua HTTP) — mới test trực tiếp qua `runVideoPlanner()`/CLI, cơ chế
  route chỉ là truyền tham số qua nên rủi ro thấp nhưng chưa có bằng chứng trực tiếp.
- Chưa test Edge TTS rate khác 1.1 kết hợp với "sub" template's chunking timing thật
  (rate nhanh hơn → word_timestamps khít hơn → chunk có thể ngắn hơn 6 từ tự nhiên) —
  về lý thuyết không ảnh hưởng vì chunking chạy trên word_timestamps THẬT bất kể rate
  nào tạo ra chúng, nhưng chưa render thật để xác nhận.

### Bug thật phát hiện ngay sau đó (cùng phiên, user báo lỗi thật qua UI)

User báo "Lint lỗi trên compositions/scene_03.html" — kiểm tra `job-status.json` +
chạy lại `lint()` trên đúng file thật thì thấy: **0 lỗi (error), chỉ có 1 warning**
(`timeline_track_too_dense` — gợi ý nên tách file nhỏ hơn, không phải lỗi chặn render).
Đọc lại `sub-scene-writer.mjs` thì lộ ra bug thật: dòng
`if (ownFindings.length) return {ok:false,...}` coi **BẤT KỲ finding nào** (kể cả
warning) là thất bại, không lọc theo `severity`. Đáng chú ý: warning này giờ sẽ là
trường hợp PHỔ BIẾN cho template "sub" — vì chính tính năng chunking caption vừa thêm
(mục 3 ở trên) cố ý đặt nhiều `class="clip"` div cùng 1 track, nên nếu không sửa thì
gần như MỌI scene "sub" có ≥2 chunk sẽ bị báo fail sai.

**Đã vá**: chỉ coi `severity === "error"` là thất bại thật; warning vẫn được ghi nhận
qua `onEvent({type:"static-check",...})` (không im lặng bỏ qua) nhưng không chặn kết
quả `ok:true`. Test lại bằng cách gọi thẳng logic lint/filter mới trên file thật (không
chạy lại `runSubSceneWriter` để tránh tốn thêm 1 lần gọi DashScope image-gen vô ích, vì
`dashscope-image.mjs` — khác `edge-tts.mjs` — chưa có cơ chế skip-nếu-đã-tồn-tại): xác
nhận `scene_03.html` hiện tại PASS đúng (0 error, 1 warning không chặn). Đã sửa
`job-status.json` của project thật (`su-im-lang-doc-hai-se-giet-chet-dan-moi-quan-he`)
về đúng trạng thái `done` qua chính hàm `emitProgress()` (không hand-edit JSON) — user
không cần bấm generate lại, không tốn thêm quota.

**Việc phụ phát hiện, chưa làm** (ghi lại để không quên): `dashscope-image.mjs` không
có cơ chế skip-nếu-ảnh-đã-tồn-tại như `edge-tts.mjs` có cho audio — mỗi lần
`runSubSceneWriter` chạy lại (kể cả chỉ để sửa lỗi caption) đều tốn 1 lần gọi sinh ảnh
mới, dù ảnh cũ vẫn còn dùng được. Nên thêm `existsSync` check tương tự TTS.

**✅ Đã sửa (cùng phiên, ngay sau khi user xác nhận)**: `generateAndSaveImage()` giờ
check `existsSync(destPath)` trước, skip hoàn toàn (không gọi API) nếu ảnh đã có —
trả thêm field `skipped: true|false`. `sub-scene-writer.mjs` bắn event `"image-skip"`
thay vì `"image"` khi skip, để onEvent/UI phân biệt được. **Test thật bằng cách chạy
lại `test-sub-scene-writer.mjs` trên đúng `scene_03`** (chính scene vừa gặp bug lint ở
trên, đã có sẵn ảnh từ lần chạy trước) — log xác nhận `image-skip` (không tốn tiền) rồi
`PASS` thật (không phải sửa tay `job-status.json` như lần trước) — 2 bug (lint
severity + image skip) giờ đã verify cùng lúc trên cùng 1 scene thật.

---

## Đã làm — Chọn model runtime + preview ảnh + prompt prefix dạng textarea (phiên 2026-08-01)

User cho danh sách 15 model DashScope (3 nhóm: đắt/rẻ/ảnh) muốn chọn được qua UI thay
vì cố định trong `.env`, + nút xem ảnh AI đã sinh, + nâng cấp `imageStylePrefix` theo
đúng Pixelle-Video.

### Verify từng model thật trước khi đưa vào UI — không tin tên gọi

Gọi thật (chat completion rẻ nhất + thử `tool_calls` bằng tool giả `write_file`) cho
7 model nhóm đắt/rẻ, và gọi thật `generateImage()` cho 6 model nhóm ảnh:

| Nhóm | Model | Kết quả thật |
|---|---|---|
| Đắt | `qwen3.5-plus` | ✅ OK, có tool_calls |
| Đắt | `qwen-plus-2025-04-28` | ✅ OK, có tool_calls |
| Đắt | `qwen-vl-ocr` | ❌ Lỗi 400 — cần ẢNH đầu vào, không phải model chat thường (tên có "ocr" là đúng nghĩa đen) |
| Rẻ | `qwen-mt-flash` | ❌ Lỗi 400 khi thử tool_calls — chỉ là model DỊCH THUẬT (mt = machine translation), không hỗ trợ function calling |
| Rẻ | `deepseek-v4-flash` | ✅ OK, có tool_calls |
| Rẻ | `qwen3.6-flash` | ✅ OK, có tool_calls |
| Rẻ | `qwen-flash` | ✅ OK, có tool_calls |
| Rẻ | `qwen3-vl-flash` | ✅ OK, có tool_calls |
| Ảnh | `wan2.1-kf2v-plus`, `wan2.7-i2v`, `wan2.6-t2v` | ❌ Lỗi "url error" — đây là model SINH VIDEO (keyframe-to-video/image-to-video/text-to-video), cần input ảnh/endpoint hoàn toàn khác, KHÔNG tương thích code sinh ảnh tĩnh hiện tại |
| Ảnh | `qwen-image` | ⚠️→✅ Lần đầu lỗi "size không hợp lệ" — model này có bộ size riêng khác `wan2.6-image` |
| Ảnh | `qwen-image-2.0`, `z-image-turbo` | ⚠️→✅ Lần đầu "no image (unknown reason)" — hoá ra do bug parse (xem dưới), không phải model lỗi |

### 2 bug thật phát hiện trong lúc verify model ảnh — đã sửa `dashscope-image.mjs`

1. **Size hợp lệ khác nhau theo từng model family** — `wan2.6-image` chấp nhận size tự
   do trong ngân sách pixel, nhưng `qwen-image` (và họ hàng) chỉ chấp nhận 1 tập cố
   định (`1664*928, 1472*1104, 1328*1328, 1104*1472, 928*1664`). Đã thêm `SIZE_TABLES`
   theo từng model thay vì 1 bảng `SIZE_FOR_FORMAT` chung.
2. **Bug parse bỏ sót ảnh thật** — code cũ chỉ nhận diện phần tử ảnh trong response
   stream khi có `part.type === "image"`. Đọc raw response thật của `qwen-image` mới
   phát hiện: model này KHÔNG trả field `type`, chỉ có `part.image` — code cũ coi đây
   là "không có ảnh" dù request đã thành công 100% (có URL ảnh thật trong response).
   Sửa: chỉ cần `part.image` tồn tại, không đòi `type` nữa.

Sau khi vá cả 2, **test lại thật cả 4 model ảnh qua đúng `generateImage()`** (không
phải raw fetch nữa): `wan2.6-image`, `qwen-image`, `qwen-image-2.0`, `z-image-turbo`
đều trả về URL ảnh thật thành công.

### Model chọn runtime — theo đúng pattern `fontFamily`/`template` đã có

`video-planner.mjs` nhận thêm `cheapModel`/`imageModel`, ghi vào `video-plan.json`
(code ghi, không tin model LLM tự nhớ) — mọi bước sau (`scene-writer`,
`sub-scene-writer`, `root-composer`) đọc lại từ đó, đảm bảo nhất quán 1 model cho toàn
bộ video dù người dùng chỉ chọn 1 lần ở bước video-plan. `content-planner`/
`video-planner` tự nhận `model` riêng (không cần persist vì chỉ gọi 1 lần/video).
UI (`Pipeline.jsx`) thêm `ModelSelect` — dropdown "Model mặc định (.env)" + danh sách
đã verify, đặt ở bước 1 (content-planner) và bước 3 (video-planner + cheap + ảnh).

**Bug thật phát hiện khi test qua HTTP** (không phải do code model-selection): sau khi
gửi `cheapModel`/`imageModel` qua `curl`, `video-plan.json` ghi `undefined` cho 2 field
này dù `fontFamily`/`imageStylePrefix` vẫn đúng — nghi code sai, nhưng hoá ra là do
**có 1 tiến trình server CŨ sống sót từ rất lâu trước** (khởi động qua `npm start`,
command line `node --env-file=../.env index.mjs` khác hẳn cách mình vẫn dùng
`node --env-file=.env server/index.mjs`) vẫn đang giữ port 3001 — lệnh `pkill -f
"server/index.mjs"` không khớp được command line đó nên không kill được, và server
MỚI của mình fail âm thầm bind port trong khi server CŨ (code chưa có cheapModel/
imageModel) vẫn phục vụ request. Đã `kill` đúng PID, xác nhận qua `ps` chỉ còn 1
process, test lại — `cheapModel`/`imageModel` ghi đúng, và `scene_01.png` sinh ra thật
đúng kích thước `928x1664` của `qwen-image` (khác `864x1536` mặc định của
`wan2.6-image`) — xác nhận model được dùng thật, không chỉ đọc field.

### Preview ảnh AI trên UI

`GET /projects/:id/images/:name` (route mới, cùng pattern an toàn với `/renders/:name`
— `res.sendFile` + chặn path traversal). `SceneGrid.jsx` thêm nút "Xem ảnh"/"Ẩn ảnh"
mỗi scene đã generate — tự ẩn kèm thông báo nếu scene đó không có ảnh (style thuần
CSS/GSAP, `onError` trên `<img>`). Test thật qua `curl`: `HTTP 200`, đúng file PNG thật
928×1664.

### `imageStylePrefix` → textarea (đối chiếu đúng Pixelle-Video theo yêu cầu)

Đọc `web/components/style_config.py` của Pixelle: field `prompt_prefix` dùng
`st.text_area` (nhiều dòng), không phải `st.text_input` (1 dòng) như mình đang làm.
Sửa `<input>` thành `<textarea rows={2}>` cho khớp UX gốc.

### Chưa làm / biết trước
- Chưa tích hợp model SINH VIDEO (`wan2.1-kf2v-plus`/`wan2.7-i2v`/`wan2.6-t2v`) — cần
  endpoint + luồng khác hẳn (khả năng là async task-submit-rồi-poll, chưa xác minh),
  ngoài phạm vi yêu cầu lần này (user chỉ liệt kê tên, không yêu cầu tích hợp video-gen
  đầy đủ). Nếu sau này cần, phải research riêng endpoint DashScope video generation.
- ~~Chưa test `ModelSelect` dropdown thật qua trình duyệt~~ — **đã test xong cùng
  phiên**: Playwright thật, tạo project → dropdown model hiện đúng ở bước 1, chọn được
  `qwen3.5-plus`, 0 lỗi console, screenshot xác nhận UI đúng.

## Đã sửa — flash sáng vài frame ở đáy scene "sub" (phiên 2026-08-01, user gửi screenshot bug thật)

User báo: video render ra tốt, nhưng thỉnh thoảng 2-3 frame trong 1 scene bị 1 dải sáng
màu (giống màu nền ảnh) chèn vào đáy khung hình, ngay dưới phụ đề — gửi kèm screenshot
đúng lúc caption "đó mẩu giấy nhỏ trong giờ" (scene_01 của project
`tinh-yeu-tuoi-hoc-tro-that-trong-sang`, chunk2, data-start=2.288625).

**Điều tra (real evidence, không đoán):**
- Grep narration → xác định đúng scene/project/chunk khớp screenshot.
- Dùng Playwright mở thẳng `compositions/scene_01.html`, đo `getBoundingClientRect()`
  của `.s1-shade` → `bottom: 1920` khớp chính xác đáy khung hình 1080×1920. Vậy CSS/
  hình học trong composition **không sai**.
- Crop bottom 100px của `assets/images/scene_01.png` (ảnh AI nguồn) → chỉ là màu nền
  peach phẳng, không có artifact — ảnh nguồn cũng không sai.
- Dùng `ffmpeg` trích **toàn bộ frame gốc 30fps** (không downsample) từ
  `renders/video_2026-08-01_21-44-20.mp4` trong đúng cửa sổ chunk2 (2.0–4.0s), rồi
  `python3`/PIL sample màu pixel ở hàng gần đáy (h-3) mỗi frame → phát hiện đúng
  **1/60 frame** (frame `g_037`) có màu sáng bất thường (avgR 244 so với ~70-90 các
  frame khác). Crop trực tiếp frame đó → thấy rõ: gradient tối `.s?-shade` bị **cắt cụt
  giữa chừng** (hard edge), để lộ 1 dải màu nền phẳng bên dưới — đúng là artifact thật,
  không phải mắt nhìn nhầm.
- Vì hình học composition đã verify đúng và chỉ 1/60 frame bị lỗi (không phải toàn bộ
  scene), đây là dấu hiệu **race condition ở tầng capture frame**, không phải bug logic
  trong HTML/CSS composition.

**Nguyên nhân nghi ngờ + verify:** `npx hyperframes render --help` cho thấy cờ
`--experimental-fast-capture` — mặc định BẬT trên macOS (đọc DOM paint record trực tiếp
qua `drawElementImage` thay vì `Page.captureScreenshot`, nhanh hơn ~2x nhưng dễ đọc
trúng khung hình giữa lúc DOM đang mutate). Frame lỗi rơi đúng vào cửa sổ hiển thị của
1 caption chunk — đúng lúc HyperFrames toggle `class="clip"` cho chunk mới (DOM mutate).

**Verify fix:** render lại cùng scene với `--no-experimental-fast-capture` → quét toàn
bộ 60 frame trong cùng cửa sổ 2.0-4.0s bằng script pixel-sampling y hệt → **0 frame
lỗi**. Render lại lần 2 (default, KHÔNG tắt cờ) để kiểm tra bug có tái lập không → cũng
**0/287 frame lỗi** — nghĩa là bug này **không deterministic** (không phải cứ bật cờ là
chắc chắn lỗi), đúng bản chất race condition. Không chứng minh được nhân-quả tuyệt đối,
nhưng tắt fast-capture loại bỏ hẳn code path dễ gây race này, và render vẫn nhanh (~12s
cho 1 scene 9.5s), nên giữ làm mitigation mặc định thay vì chờ user báo lại nhiều lần.

**Đã áp dụng cờ vào cả 2 nơi gọi render:**
- `server/tools/hyperframes-cli.mjs` — `RENDER_ARGS = ["render", "--no-experimental-fast-capture"]`,
  dùng cho nhánh Web UI (DashScope).
- `CLAUDE.md` + `AGENTS.md` bước [8] — cập nhật lệnh mẫu cho luồng Claude Code chính
  thành `npx hyperframes render --no-experimental-fast-capture`, kèm giải thích ngắn.

Dọn file render test (`test-nofastcapture.mp4`, `test-default-retry.mp4`) khỏi
`output/2026-08-01/tinh-yeu-tuoi-hoc-tro-that-trong-sang/video/renders/` sau khi verify
xong, chỉ giữ lại render thật của user.

### Chưa làm / theo dõi tiếp
- Chưa có cách chứng minh 100% root cause (nondeterministic) — nếu user còn gặp lại
  artifact này sau khi có `--no-experimental-fast-capture`, cần điều tra hướng khác
  (có thể là timing giữa `class="clip"` toggle và animation-frame capture nói chung,
  không riêng gì fast-capture path).

## Đã sửa — UI "3. Video plan" tràn ra ngoài card (phiên 2026-08-01)

User gửi screenshot: hàng control ở bước 3 (7 dropdown/textarea/button) tràn ra ngoài
viewport. Nguyên nhân: `.card select`/`.card textarea` có `width: 100%`, nhưng
`.inline-form` không có `flex-wrap` — mỗi control đòi 100% chiều rộng dòng, ép cả hàng
vượt khung. Fix: `.inline-form { flex-wrap: wrap }` + override `width: auto` (kèm
min/max hợp lý) riêng cho `select`/`textarea` bên trong `.inline-form`. Verify bằng
Playwright dựng lại đúng markup+CSS của form này (không chạy pipeline thật, tốn API) ở
viewport 1200px → trước đây tràn, giờ dư ~546px và tự wrap 3 hàng gọn.

## Đã sửa — atmosphere neon-green đè lên scene "sub" ấm áp (phiên 2026-08-01, user gửi screenshot bug thật)

User báo: video "sub karaoke" (ảnh AI full-bleed, tông ấm/peach) vẫn dính viền góc màu
xanh neon (`#39FF14`) — rõ ràng lạc tông.

**Root cause**: `runRootComposer` LUÔN nhận `DESIGN.md` gốc của workspace (palette
neon-green "dark tech", dùng cho style "motion" mặc định) làm ngữ cảnh, kể cả khi
`template === "sub"`. Scene "sub" (`image_full_focus.mjs`) là ảnh AI full-bleed tự
authored HOÀN TOÀN ngoài LLM (đã ghi rõ trong comment file đó), không liên quan gì đến
DESIGN.md — nhưng root-composer's system prompt yêu cầu atmosphere layer (bg-dots/
bg-glow/scanlines/4 góc) VÔ ĐIỀU KIỆN, nên model vẫn vẽ atmosphere theo màu neon của
DESIGN.md, đè lên ảnh ấm.

**Fix**: `root-composer.mjs` nhận thêm param `template`; khi `template === "sub"`, thay
bullet atmosphere bằng chỉ dẫn **bỏ hẳn** atmosphere layer (chỉ còn scene clips + music
+ voiceover). `routes.mjs` (`POST /projects/:id/root`) và `test-root-composer.mjs` đều
truyền `template: videoPlan.template` vào.

**Verify thật**: chạy lại `test-root-composer.mjs` trên project
`tinh-yeu-tuoi-hoc-tro-that-trong-sang` (template="sub" có sẵn) → PASS sau 2 attempt,
grep `index.html` mới không còn `corner`/`bg-dots`/`bg-glow`/`scanline` nào. Render lại
thật (`--no-experimental-fast-capture`), trích frame ở t=1.5s → xác nhận bằng mắt: hết
sạch viền neon góc, chỉ còn ảnh AI + phụ đề. Dọn file render test sau khi verify.

## Mới — "Chạy toàn bộ pipeline" + channel profile (phiên 2026-08-01)

User yêu cầu 3 việc liên quan: (1) gom hết input thủ công (audience, TTS, template/
style/font/image-prefix, chọn model) lên 1 form duy nhất ở đầu trang thay vì rải rác
theo từng bước, (2) 1 nút "Chạy toàn bộ pipeline" chạy nối tiếp content-plan → audio →
video-plan → generate mọi scene → root → render, mặc định DỪNG lại sau khi có
`scenes.json` (bước rẻ) để xác nhận trước khi chạy phần tốn phí, có checkbox để bỏ qua
dừng và chạy 1 mạch, (3) lưu/nạp lại "profile kênh" (model, TTS rate, template/style,
font, image style prefix) để tái dùng giữa các project của cùng 1 kênh — **không gồm
audience**, vì đó là input theo từng video cụ thể, không phải theo kênh (thống nhất
với user trước khi code).

### Backend
- `server/lib/profiles.mjs` (mới) — lưu profile dạng file JSON phẳng ở
  `server/profiles/<slug>.json`, không theo project (dùng lại xuyên suốt workspace,
  giống cách `DESIGN.md` không thuộc riêng project nào). Tên profile do user gõ →
  `slugify()` (bỏ dấu, lowercase, chỉ giữ a-z0-9-) làm tên file, tránh path traversal
  từ input không tin cậy — cùng logic phòng thủ như `project-id.mjs` nhưng đơn giản
  hơn vì không có cấu trúc thư mục lồng nhau để escape.
- `routes.mjs` — `GET /profiles`, `PUT /profiles/:name` (tạo/cập nhật), `DELETE
  /profiles/:slug`.
- `web/src/api.js` — `listProfiles`, `saveProfile`, `deleteProfile`.

### Frontend (`Pipeline.jsx`, viết lại toàn bộ)
- Card "Cấu hình pipeline" ở đầu trang, gồm: dropdown chọn profile (áp dụng ngay khi
  chọn) + ô tên + nút lưu/cập nhật, rồi đến audience (không thuộc profile), TTS
  provider/rate, template/style/font/image-prefix/3 model select — đúng các field
  trước đây nằm rải rác trong `inline-form` của bước 1 và bước 3. Các bước 1–5 vẫn giữ
  nguyên nút bấm tay riêng (theo đúng yêu cầu "vẫn giữ"), chỉ bớt phần input trùng lặp
  — bấm nút vẫn dùng chung state đã gom lên trên.
- `runAllPipeline({skipPause})` — dùng `stepsRef` (mirror `steps` từ `useJobStatus` qua
  `useEffect`) + `waitForStep()` (poll `stepsRef` tới khi `status==="done"/"error"`) để
  chờ tuần tự từng bước, và `ensureStepDone()` để bỏ qua bước nào đã `"done"` sẵn — cho
  phép bấm "Chạy toàn bộ" giữa chừng sau khi đã tự chạy tay vài bước mà không chạy lại
  từ đầu. Mặc định dừng lại sau bước `plan` (hiện banner "Tiếp tục pipeline"); checkbox
  "Chạy 1 mạch" bỏ qua điểm dừng này.

### Verify thật (Playwright + backend thật, không giả định)
- Phát hiện lại đúng bug "stale server process" đã gặp trước đây trong phiên này (PID
  cũ 7205 vẫn phục vụ code trước khi thêm route `/profiles` → 3 lỗi 404 khi test) —
  kill đúng PID, khởi động lại từ đúng cwd (repo root, không phải `server/`, vì
  `--env-file=.env` cần `.env` ở gốc) → xác nhận qua `ps`/`lsof` chỉ còn 1 process đúng.
- Test layout: tạo project thật qua UI → không có phần tử nào overflow viewport
  (`scrollWidth` check), screenshot xác nhận card gọn 2 hàng.
- Test lưu profile: điền `cheapModel=qwen-flash`, đặt tên "Test Channel Profile", bấm
  lưu → gọi API thật, backend ghi file JSON thật, dropdown tự chọn đúng profile vừa
  lưu, nút đổi label "Lưu thành profile mới" → "Cập nhật profile".
- Test nạp lại cross-project (đúng mục đích chính của tính năng): tạo project THỨ HAI
  hoàn toàn khác, chọn lại đúng profile vừa lưu ở project đầu → `cheapModel` tự điền
  đúng `qwen-flash` — xác nhận profile persist qua project, không phải chỉ trong 1
  session/component state.
- Dọn toàn bộ project test (`output/2026-08-01/{overflow-ui-check,
  setup-card-overflow-check, setup-card-overflow-profile-check, profile-save-check-v2,
  load-profile-check-v2-fresh-project, debug-run2, ui-model-dropdown-check}`) và file
  profile test (`server/profiles/test-channel-profile.json`) sau khi verify xong.

### Cập nhật — nút Xoá profile (cùng phiên, user yêu cầu thêm ngay sau)
Sửa profile không cần code riêng — chọn profile, đổi field, bấm "Cập nhật profile" là
ghi đè đúng file cũ (cùng `slugify(profileName)`). Thêm nút "Xoá profile" (chỉ hiện khi
đã chọn 1 profile), có `window.confirm` trước khi gọi `DELETE /profiles/:slug`.

Verify thật qua Playwright + gọi thẳng API kiểm tra persisted state (không chỉ tin UI):
lưu profile → đổi `cheapModel` → "Cập nhật profile" → `GET /profiles` xác nhận giá trị
mới đã ghi đè đúng file cũ (không tạo file trùng) → bấm "Xoá profile" → `GET /profiles`
xác nhận profile biến mất thật khỏi backend, không chỉ ẩn trên UI.

### Chưa làm / theo dõi tiếp
- `runAllPipeline` sinh scene TUẦN TỰ (từng scene chờ xong mới sang scene tiếp), không
  chạy song song nhiều scene cùng lúc — an toàn/dễ debug hơn cho v1, nhưng chậm hơn
  nếu video có nhiều scene. Có thể đổi sang `Promise.all` sau nếu cần nhanh hơn.

## Đã sửa — 2 scene cuối render ra không có voice/không có sub (phiên 2026-08-01, user báo bug thật trên video mới nhất)

User báo: video mới nhất (`tinh-yeu-tuoi-hoc-tro-that-trong-sang`), scene 5 và 6 render
ra không có voice và không có phụ đề.

**Điều tra**: `scenes-with-timing.json` cho thấy scene_05/06 có `narration` thật nhưng
`word_timestamps: []` và KHÔNG có file `assets/audio/scene_05_vo.mp3`/`scene_06_vo.mp3`
trên đĩa — TTS chưa bao giờ thực sự chạy cho 2 scene này dù `job-status.json` ghi bước
"audio" là `"done"`. `index.html` (root) cũng thiếu hẳn 2 thẻ `<audio id="vo-05">`/
`<audio id="vo-06">`.

**Root cause — 2 bug thật, không phải 1**:
1. `server/routes.mjs`'s `/audio` route gọi
   `runInBackground(req.projectDir, "audio", () => queues.tts.run(() =>
   runGenerateAudio(req.projectDir, {ttsProvider, ttsRate})))` — `taskFn` khai báo
   KHÔNG nhận tham số `onEvent` mà `runStep()` truyền vào, nên `onEvent` bị rớt hoàn
   toàn, không bao giờ đến được `runGenerateAudio`. Mọi route khác (`/plan`,
   `/video-plan`, `/scenes/:id/generate`, `/root`) đều đúng dạng `(onEvent) => ...` —
   chỉ riêng `/audio` bị quên.
2. `generate-audio.mjs`'s `generateVoiceover()` bắt lỗi TTS từng scene và trả `null`
   (để 1 scene lỗi không làm hỏng cả batch) — nhưng lỗi đó chỉ được báo qua `onEvent`
   (vốn đã rớt vì bug 1), và vòng lặp chính vẫn tiếp tục dùng
   `voDuration = ... ?? scene.estimated_duration ?? 5` làm fallback, ghi
   `word_timestamps: []`, rồi TOÀN BỘ hàm vẫn `return output` bình thường (không có
   field `ok`) → `runStep()` luôn coi là thành công. Kết quả: 1 scene TTS lỗi biến mất
   không dấu vết, bước "audio" vẫn báo "done".

**Fix**:
- `routes.mjs` — sửa `/audio` thành `(onEvent) => queues.tts.run(() =>
  runGenerateAudio(req.projectDir, {ttsProvider, ttsRate, onEvent}))`.
- `generate-audio.mjs` — thu thập `failedSceneIds` (scene có `narration` nhưng
  `generateVoiceover()` trả `null`); nếu có, trả về `{...output, ok:false, error, 
  failedSceneIds}` — `runStep()` đã có sẵn quy ước coi `ok:false` như throw (cùng cách
  `scene-writer`/`render` báo lỗi), nên bước "audio" giờ hiện đúng "error" thay vì
  "done" giả. File `scenes-with-timing.json` vẫn được ghi trước đó nên chạy lại
  `/audio` là rẻ — scene đã có audio thật được skip (`existsSync` check có sẵn), chỉ
  retry đúng scene lỗi.
- `scripts/generate-audio.mjs` (CLI, luồng Claude Code chính) — vốn đã truyền
  `onEvent` đúng từ đầu nên không bị bug 1, nhưng thêm dòng cảnh báo khi
  `failedSceneIds` không rỗng ở event `"done"`, khớp với field mới.

**Verify + fix thật cho video của user** (không chỉ sửa code, còn sửa luôn video đang
lỗi): restart backend → gọi lại `POST /audio` qua API thật → 4 scene đầu skip (đã có
audio), scene_05/06 chạy TTS thật, `failedSceneIds: []`, sinh đúng
`scene_05_vo.mp3`/`scene_06_vo.mp3` (43KB/36KB) + `word_timestamps` 30/22 từ. Gọi lại
`/scenes/scene_05/generate` + `/scenes/scene_06/generate` để viết lại phụ đề thật từ
timestamps mới (ảnh AI cũ được skip, không tốn thêm phí). Gọi lại `/root` → `index.html`
mới có đủ `vo-05`/`vo-06`. Render lại thật → trích frame ở scene 5 (~t=29.5s): phụ đề
"Tuổi học trò qua đi nhưng..." hiện đúng; trích riêng đoạn audio scene 5 ra file mp3
riêng (80KB, không rỗng) xác nhận có tiếng nói thật, không phải track câm.

### Chưa làm / theo dõi tiếp
- Chưa xác định được TẠI SAO TTS ban đầu lỗi cho đúng 2 scene cuối (gọi lại y hệt
  narration đó ở lần test thì thành công, mất ~30-50s — nghi ngờ edge-tts/WebSocket bị
  chậm/timeout thoáng qua do mạng, không phải lỗi cố định theo nội dung text). Bug 1+2
  ở trên là cái khiến lỗi tạm thời đó biến thành "mất vĩnh viễn không dấu vết" — đã sửa
  xong phần đó; bản thân độ ổn định của edge-tts dưới tải/mạng chậm vẫn có thể tái diễn,
  giờ sẽ được báo lỗi rõ ràng thay vì im lặng.

## Mới — Remix video (chỉ style "sub") (phiên 2026-08-01)

User muốn remix lại narration của 1 video "sub" đã render (đổi văn phong/đối tượng) mà
KHÔNG sinh ảnh AI lại (tốn token nhất trong pipeline) — vì `generateAndSaveImage()` đã
skip-if-exists theo đúng `sceneId` (không theo nội dung prompt), reuse ảnh cũ 100% miễn
là giữ đúng danh sách `sceneId`. Quyết định trước khi code (Q&A với user): remix tạo
**project MỚI** (copy ảnh sang, giữ project gốc nguyên vẹn để so sánh/rollback), có
input: project gốc, 1 custom prompt bắt buộc (yêu cầu remix tự do, không dropdown dựng
sẵn — nhu cầu quá đa dạng để cố định), và font chữ tuỳ chọn (mặc định giữ font gốc).

### Kiến trúc
- `server/pipeline/remix-project.mjs` (mới, KHÔNG gọi LLM) — `createRemixProject()`:
  validate project gốc phải `template==="sub"` (chặn từ đầu, không phải style "sub" thì
  không có gì để tái dùng theo đúng cách này), gọi `createProject()` có sẵn để scaffold
  project mới, copy `assets/images` + `assets/music` + `assets/sfx` + `DESIGN.md` bằng
  `cpSync(..., {recursive:true, filter: bỏ qua "._*"})`. **CỐ Ý KHÔNG COPY
  `assets/audio`** — đó là giọng đọc theo narration CŨ; nếu copy sang, bug y hệt vừa sửa
  ở trên sẽ tái diễn kiểu ngược: `generate-audio.mjs`'s `existsSync(dest)` sẽ tưởng đã
  có audio nên SKIP luôn, giữ nhầm giọng đọc cũ đọc script cũ. Ghi `video-plan.json`
  bằng cách copy nguyên object từ project gốc (giữ `image_prompt`/`template`/`subStyle`/
  model...), chỉ patch `fontFamily` nếu user chọn đổi.
- `server/agents/remix-scenes.mjs` (mới, có gọi LLM) — nhận scene gốc (chỉ
  `sceneId`/`narration`/`meaning`/`mood_hint`/`is_hook`/`estimated_duration`, cắt bỏ
  `_audio` cũ và mọi field ảnh — không đưa cho model thứ có thể khiến nó tưởng cần đổi
  ảnh/scene). Prompt bắt buộc: giữ NGUYÊN số scene/thứ tự/`sceneId`, chỉ viết lại
  `narration`/`meaning`, không lái ý nghĩa hình ảnh quá xa (ảnh đã cố định, câu mới vẫn
  phải hợp lý khi đặt lên đúng ảnh cũ). Sau khi ghi `scenes.json`, tự so `sceneId` nhận
  được với danh sách gốc — lệch (thêm/bớt/đổi tên scene) thì throw lỗi rõ ràng thay vì
  để lọt xuống bước audio rồi mới vỡ lẽ ảnh không khớp.
- `routes.mjs` — `POST /projects/:id/remix` (id = project GỐC trong URL): validate
  `remixPrompt` bắt buộc, gọi `createRemixProject()` (sync, nhanh) → `emitProgress`
  đánh dấu bước `"video-plan"` là `"done"` NGAY (đã copy sẵn, hợp lệ) → chạy
  `runRemixScenes()` ở background dưới step `"plan"` (đúng tên step "plan" vì đây chính
  là bước tương đương content-planner, chỉ khác input). Response trả `id` của project
  MỚI ngay lập tức (201) — không đợi LLM xong, giống pattern các step khác.
- Frontend: `Pipeline.jsx` fetch `video-plan.json` của project hiện tại (chỉ khi
  `videoPlanStatus==="done"`) để đọc `.template` — card "Remix video này" chỉ hiện khi
  `template==="sub"`. Nút bấm gọi `api.runRemix()`, thành công thì gọi
  `onProjectCreated(newId, remixPrompt, platform)` — prop mới truyền từ `App.jsx`
  (dùng lại đúng `handleCreated`, giống hệt cách tạo project thường) để tự động chuyển
  sang xem project remix mới, không cần user tự tìm trong `ProjectPicker`.

### Verify thật (không giả định)
- Gọi thật `POST /remix` trên project `tinh-yeu-tuoi-hoc-tro-that-trong-sang` (6 scene,
  đã render) → project mới tạo ngay, `ls assets/images` có đủ 6 file, **`assets/audio`
  không tồn tại** (đúng thiết kế), `video-plan.json.fontFamily` đổi đúng theo yêu cầu,
  `job-status.json`'s `video-plan` step là `"done"` ngay lập tức không cần chờ.
  - Lần test đầu tiên (không chỉ định `model`) → DashScope trả 403
    `AllocationQuota.FreeTierOnly` (hết quota free tier THẬT của tài khoản, không phải
    bug) — job-status ghi đúng `"error"` với message rõ ràng, `scenes.json` KHÔNG bị
    ghi dở dang. Xác nhận cơ chế báo lỗi hoạt động đúng (không giống bug audio ở trên).
  - Đổi sang `model: "qwen-plus-2025-04-28"` (1 trong các model đã khai báo sẵn trong
    `EXPENSIVE_MODELS`) → thành công, `scenes.json` sinh ra đúng 6 sceneId (không
    thêm/bớt), narration mới đổi đúng văn phong yêu cầu (vd scene_01: "ai đó" → "crush",
    dí dỏm hơn) mà vẫn giữ đúng ý nghĩa cảnh gốc.
- Playwright thật trên UI: trỏ `localStorage` thẳng vào project sub thật (không cần
  chạy lại từ đầu) → card "Remix video này" hiện đúng, dropdown font hiện đúng
  "Giữ font gốc (Itim)" (đọc đúng từ `video-plan.json` thật), không tràn layout
  (`scrollWidth` check), 0 lỗi console, nút bấm enable đúng khi có nhập prompt.
- Dọn project test (`output/2026-08-01/doi-van-phong-sang-hai-huoc-di-dom-hon-giu-nguyen-`)
  sau khi verify xong.

### Chưa làm / theo dõi tiếp
- Chưa có UI hiện lại danh sách các project đã "remix từ" project nào (không lưu quan
  hệ cha-con giữa project gốc và project remix ở đâu cả — nếu cần, có thể thêm 1 field
  `remixedFrom: <sourceId>` vào `video-plan.json` hoặc `job-status.json` của project
  remix).
- Chưa test full end-to-end remix → audio → scene → root → render (chỉ verify tới bước
  `scenes.json` do quota LLM lần đầu bị chặn, và không muốn tốn thêm phí TTS/render chỉ
  để test UI text) — nhưng audio/scene/root/render đều dùng lại đúng route/hàm đã verify
  kỹ ở các phiên trước, rủi ro thấp.

### Cập nhật — Remix card thiếu ô chọn model (user báo lỗi thật ngay sau khi dùng)
User bấm Remix qua UI → lỗi `403 AllocationQuota.FreeTierOnly` y hệt bug quota gặp lúc
test — nguyên nhân: card Remix quên thêm `ModelSelect`, luôn dùng `DEFAULT_MODEL` từ
`.env` (`qwen3.6-plus`, đã hết quota) không cho đổi. Thêm `ModelSelect` (dùng lại đúng
`EXPENSIVE_MODELS`) vào card, wire `model` vào `api.runRemix()`. Verify thật qua
Playwright: chọn `qwen-plus-2025-04-28` trong dropdown mới, bấm remix → thành công,
điều hướng đúng sang project mới, `job-status` step "plan" báo "done".

## Mới — Live log (SSE events) + nghe thử voice trước khi generate scene (phiên 2026-08-02)

User chọn đào sâu hướng UX, chốt 2 việc: (1) hiện log chi tiết trong lúc chờ 1 bước
chạy thay vì chỉ có badge "Đang chạy" tĩnh — dữ liệu SSE (`onEvent`) đã có sẵn đầy đủ từ
lâu nhưng chưa từng hiển thị ở đâu trong UI; (2) nghe thử voice của từng scene NGAY
trong `SceneGrid` trước khi bấm Generate — vì đúng bug scene 5/6 vừa sửa (audio lỗi im
lặng) đáng lẽ phát hiện được sớm hơn nhiều nếu nghe thử trước khi tốn tiếp tiền ảnh/scene.

### Live log
- `web/src/components/LiveLog.jsx` (mới) — `formatEvent(e)` map từng `type` sự kiện
  (khác nhau tuỳ nguồn: `run-agent.mjs`'s `assistant`/`tool`, `generate-audio.mjs`'s
  `scene-start`/`scene-tts-done`/`scene-error`..., `sub-scene-writer.mjs`'s
  `image`/`image-skip`/`write`, `lint`/`static-check` chung) thành 1 dòng tiếng Việt dễ
  đọc; type lạ/không quan trọng trả `null` và bị lọc bỏ thay vì dump JSON thô.
  `<LiveLog events step maxLines>` chỉ lọc đúng `event.step === step`, hiện tối đa N
  dòng gần nhất.
- `useJobStatus.js` đã có sẵn `events` (mảng SSE full trace, cap 500) nhưng
  `Pipeline.jsx` trước giờ chỉ destructure `steps`/`totalUsage`, bỏ qua — giờ lấy thêm
  `events`, truyền `<LiveLog>` vào StepRow của "plan"/"audio"/"video-plan"/"root" (chỉ
  hiện khi `status==="running"`), và truyền tiếp `events` xuống `SceneGrid` để hiện log
  riêng từng scene-card khi scene đó đang generate.
- CSS `.live-log` — box nhỏ nền `--code-bg`, monospace, `max-height:140px` tự cuộn,
  dòng cuối in đậm (dòng mới nhất) để dễ theo dõi tiến trình bằng mắt.

### Nghe thử voice trước khi generate
- Route mới `GET /projects/:id/audio/:name` (`server/routes.mjs`) — serve
  `assets/audio/<sceneId>_vo.mp3`, cùng pattern path-traversal-safety với route
  `/images/:name` đã có (`resolve`/`relative`/`isAbsolute` check, chỉ nhận `.mp3`).
- `api.js` thêm `audioUrl(id, sceneId)`.
- `SceneGrid.jsx` — `<SceneAudioPreview>` (audio player HTML5 gọn, `preload="none"`)
  hiện trong MỖI scene-card khi audio đã sinh (`audioReady` prop truyền từ
  `Pipeline.jsx` = `audioStatus==="done"`), đặt TRƯỚC nút Generate — nghe được giọng
  đọc trước khi bấm tốn tiền ảnh/scene. `onError` ẩn player nếu scene không có audio
  (không có narration) thay vì hiện player lỗi trống.

### Verify thật (Playwright + fetch trực tiếp, không giả định)
- Audio player: mở project sub thật (6 scene, đã có audio) → 6 audio player render
  đúng, `src` đúng URL, `fetch()` trực tiếp URL đó trả **HTTP 200** (không phải chỉ
  render `<audio>` tag suông — xác nhận file thật phát được).
- Live log: trigger lại `scene:scene_03` (style "sub", KHÔNG dùng LLM — code-only) →
  chạy xong trong **~0.6s**, quá nhanh để bắt live log kịp (đúng thiết kế, không phải
  bug — đã đối chiếu timestamp thật trong `job-status.json`'s `events` để xác nhận).
  Trigger lại bước "root" (CÓ LLM thật, nhiều lượt) → live log hiện đúng, cập nhật theo
  thời gian thực: `[lượt 3] gọi list_dir, list_dir` → `list_dir → ok` → `[lượt 4] gọi
  write_file` → `write_file → ok` → `Lint lần 2: 0 lỗi mới`. Regression check sau khi
  test lại root-composer trên project thật: `index.html` vẫn 0 atmosphere neon (không
  regress bug đã sửa trước đó), vẫn còn đủ `vo-05`/`vo-06`.
- Dọn AppleDouble junk sau khi test xong; không tạo project test mới lần này (test trực
  tiếp trên project sub thật đã có sẵn, chỉ trigger lại các bước vô hại/idempotent).

## Mới — 3 đề xuất: tự chuyển model khi hết quota, ProjectPicker hiện tiến độ, remixedFrom (phiên 2026-08-02)

User đồng ý làm cả 3 đề xuất cùng lúc.

### 1. Tự động chuyển model khi hết quota/rate-limit
- `server/lib/models.mjs` (mới) — khai báo tier `EXPENSIVE_MODELS`/`CHEAP_MODELS` phía
  SERVER (mirror thủ công với list phía UI trong `Pipeline.jsx` — 2 nơi khác mục đích:
  UI list cho dropdown chọn tay, list này cho fallback tự động). `nextFallbackModel(model,
  excluded)` chỉ trả model CÙNG TIER (không bao giờ tự rớt từ đắt xuống rẻ — sẽ hạ chất
  lượng output mà user không đồng ý).
- `dashscope.mjs` — `isQuotaOrRateLimitError(err)` nhận diện `(429)` hoặc message chứa
  "quota"/"throttl" (khớp đúng format lỗi thật đã gặp: `403 AllocationQuota.FreeTierOnly`).
- `run-agent.mjs` — bọc `chatCompletion()` trong vòng lặp riêng: gặp lỗi quota/rate-limit
  → thử `nextFallbackModel()` (tính theo tier của model GỐC, không phải model hiện tại,
  để `triedModels` tích luỹ đúng qua nhiều lượt), phát `onEvent({type:"model-fallback"})`,
  đổi `currentModel` — model mới dùng xuyên suốt các lượt còn lại trong cùng lần chạy,
  không phải thử lại mỗi lượt. Hết model trong tier thì mới throw lỗi gốc.
- `LiveLog.jsx` thêm case `model-fallback` → `⚠ Model "X" hết quota/rate-limit — tự
  chuyển sang "Y"`.
- **Verify thật**: gọi `/remix` KHÔNG truyền `model` (mặc định `qwen3.6-plus`, biết chắc
  đang hết quota từ trước) → job-status event thật ghi
  `{type:"model-fallback", from:"qwen3.6-plus", to:"qwen3.5-plus"}`, step "plan" chạy
  tiếp bình thường và xong — không cần user can thiệp tay như 2 lần trước.

### 2. ProjectPicker hiện trạng thái tiến độ
- `job-status.mjs`'s `summarizeProjectStatus(projectDir)` (mới) — đọc `job-status.json`
  + (nếu có) `video-plan.json` để lấy tổng số scene chính xác, trả `{label, hasError}`.
  Ưu tiên: có step lỗi → "Lỗi ở …" ; render xong → "Đã render" ; root xong → "Đã ghép,
  chưa render" ; có scene → "N/M scene xong" ; ... ; không có step nào → "Chưa bắt đầu".
- `project-id.mjs`'s `listProjects()` gọi thêm hàm này + đọc riêng `remixedFrom` từ
  `video-plan.json`, trả kèm trong mỗi project entry.
- `ProjectPicker.jsx` — hiện badge tròn (đỏ nếu `hasError`) bên phải mỗi project, thêm
  dòng "remix từ X" nếu có `remixedFrom`.
- **Verify thật**: gọi `GET /projects` thật trên toàn bộ 12 project có sẵn trong
  workspace (KHÔNG phải project test dựng riêng) → phát hiện sống 1 project thật
  (`ai-trong-marketing`) đang lỗi thật ở `scene:scene_04` mà trước giờ không hiện ở đâu
  cả — xác nhận tính năng có giá trị thật ngay lần đầu bật, không chỉ là demo.
  Playwright screenshot xác nhận badge lỗi màu đỏ nổi bật, không tràn layout.

### 3. Ghi quan hệ remix (`remixedFrom`)
- `remix-project.mjs`'s `createRemixProject()` ghi thêm field
  `remixedFrom: toProjectId(sourceProjectDir)` vào `video-plan.json` của project remix
  (thuần thông tin, không có step nào đọc lại field này để chạy logic).
  `Pipeline.jsx` hiện dòng "remix từ …" ngay dưới tên project khi mở đúng project remix
  (đọc từ `sourceVideoPlan.remixedFrom` đã fetch sẵn cho card Remix).
- **Verify thật**: remix lại chính project `tinh-yeu-tuoi-hoc-tro-that-trong-sang` →
  `video-plan.json` mới có đúng `remixedFrom` trỏ về project gốc; `GET /projects` trả
  đúng field này; `ProjectPicker` hiện đúng "remix từ tinh-yeu-tuoi-hoc-tro-that-trong-sang".

Dọn toàn bộ project test tạo ra trong lúc verify 3 tính năng này.

## Mới — Tab History + xác nhận trước "Generate lại" + sticky nav (phiên 2026-08-02)

User yêu cầu làm cả 3 cùng lúc: tab History (xem video đã render + Mở thư mục + Xoá
project), xác nhận trước khi bấm "Generate lại" (đã đề xuất ở lượt trước), và thanh
điều hướng dính (đã đề xuất ở lượt trước).

### Tab History
- `job-status.mjs`'s `summarizeProjectStatus()` trả thêm field ổn định
  `renderDone: boolean` (tách riêng khỏi `label` — không match chuỗi tiếng Việt "Đã
  render" vì label có thể đổi chữ sau này).
- `routes.mjs` — 2 route mới:
  - `POST /projects/:id/open-folder` — mở Finder/Explorer đúng thư mục project bằng
    `execFile("open"|"explorer"|"xdg-open", [projectDir])` (không phải `exec` với
    string nối — `projectDir` đã qua `resolveProjectDir()` validate, truyền thẳng làm
    1 phần tử argv, không có bề mặt injection dù có spawn process thật). Chỉ có ý
    nghĩa vì server + trình duyệt chạy cùng máy (tool cá nhân, không multi-tenant).
  - `DELETE /projects/:id` — `rmSync(projectDir, {recursive:true, force:true})`, dọn
    thêm 2 thư mục cha rỗng (`<slug>/`, `<date>/`) để không để lại vỏ rỗng trong
    `output/` và tránh đụng guard "thư mục đã tồn tại" của `new-project.mjs` nếu tạo
    lại project cùng idea/ngày.
- `web/src/components/History.jsx` (mới) — lọc `listProjects()` theo `renderDone`,
  mỗi item: `<video>` phát bản render mới nhất (`listRenders()` đã sort mới nhất
  trước), nút "Mở thư mục output", nút "Xoá project" (⚠ `window.confirm` với nội dung
  liệt kê rõ mất gì — ảnh AI đã tốn phí, audio, render — KHÔNG THỂ HOÀN TÁC, cùng
  pattern với xoá profile đã làm trước đó).
- `App.jsx` thêm tab switcher (`Pipeline` / `History`) ở header; xoá project trong
  History mà trùng đúng project đang mở ở tab Pipeline thì tự reset về màn hình tạo
  project mới (tránh Pipeline trỏ vào project đã không còn tồn tại).

### Xác nhận trước khi "Generate lại"
- `SceneGrid.jsx` — chỉ hiện `window.confirm()` khi bấm lại trên scene đã `"done"`
  (regenerate thật sự tốn phí tiềm năng nếu `image_prompt` đã đổi); lần "Generate" đầu
  tiên không hỏi gì (không có gì để mất).

### Sticky mini-nav
- `Pipeline.jsx`'s `<PipelineNav>` — thanh nút tròn dính đầu trang (dưới header, trên
  nội dung), mỗi nút có chấm màu trạng thái (giống palette `StatusBadge`) + nhảy tới
  đúng section bằng `scrollIntoView({behavior:"smooth"})`. Thêm `id` vào từng
  `StepRow`/card tương ứng (`step-config`, `step-plan`, `step-audio`,
  `step-video-plan`, `step-scenes`, `step-root`, `step-render`, `step-remix`) — mục
  "Scenes"/"Remix" chỉ hiện khi phần đó đang thực sự render trên trang (tránh nhảy vào
  chỗ trống).

### Verify thật (API + Playwright, không giả định)
- `POST /open-folder` gọi thật trên project `tinh-yeu-tuoi-hoc-tro-that-trong-sang` →
  `{ok:true}`, không lỗi (mở đúng Finder thật trên máy đang chạy server).
- Tạo project throwaway rẻ qua `/remix` (chỉ 1 lệnh LLM, không sinh ảnh) → gọi
  `DELETE /projects/:id` thật → xác nhận bằng `ls` cả thư mục `video/` VÀ thư mục
  `slug/` cha đều biến mất thật khỏi đĩa (không chỉ trả 204 suông).
- Playwright thật: mở tab History → 4 video render thật hiển thị, không tràn layout;
  chuyển sang Pipeline, bấm nút nav "5. Render" → `window.scrollY` đổi thật (1900px,
  xác nhận cuộn thật chứ không phải nút chết); bấm "Generate lại" trên scene đã xong →
  dialog `confirm` hiện đúng nội dung cảnh báo tốn phí, tự accept qua Playwright's
  dialog handler.
- Phát hiện thêm (không phải bug): `ai-trong-marketing` vẫn xuất hiện trong History dù
  đang lỗi ở `scene:scene_04` — đúng vì `renderDone` độc lập với `hasError` (video đã
  render TRƯỚC khi lỗi phát sinh ở lần chạy sau) — hành vi đúng theo thiết kế, không
  phải mâu thuẫn dữ liệu.
- Dọn hết project test + AppleDouble junk sau khi verify.

## Đã sửa — "voice cũ bị thiếu khi ghép scene mới" khi remix — hoá ra là 3 bug thật (phiên 2026-08-02)

User báo remix bị lỗi: scene chưa hết voice thì đã ghép scene mới, voice cũ bị thiếu.
Điều tra bằng cách tạo lại đúng kịch bản (remix → audio → generate scene → root) trên
project thật, KHÔNG đoán — phát hiện đây thực ra là 3 bug độc lập, không phải 1:

### Bug 1+2: root-composer không đáng tin khi tự liệt kê thẻ voiceover
Test lần đầu: root-composer chỉ viết ĐÚNG 3/6 thẻ `<audio data-track-index="21">`
(thiếu vo-01, vo-02, vo-06) dù cả 6 scene div đều đúng. Thử thêm checklist tường minh
vào prompt (liệt kê đúng id bắt buộc) — KHÔNG đủ: qua 8 lần retry, model liên tục đổi
bộ id bị thiếu khác nhau mỗi lần sửa (whack-a-mole — sửa đúng lỗi vừa báo thì làm hỏng
cái đã đúng trước đó), không bao giờ hội tụ trong `maxFixAttempts`.

**Fix theo đúng nguyên tắc đã dùng trong dự án ("code viết field cấu trúc, không tin
LLM tự liệt kê")**:
- `validators.mjs` — 2 check mới: `checkVoiceoverOverlap` (2 voiceover cùng track 21
  không được chồng thời gian) và `checkVoiceoverCompleteness` (đủ N thẻ đúng scene có
  voiceover thật) — bắt được bug ngay từ lần test đầu.
- `root-composer.mjs` — `enforceVoiceoverTags()`: sau khi LLM viết `index.html`, CODE
  tự tính lại toàn bộ khối `<audio>` track 21 (cùng công thức crossfade
  `data-start[i] = data-start[i-1] + scene_duration[i-1] - 0.3`) và GHI ĐÈ, không quan
  tâm LLM viết gì. Áp dụng ở MỌI attempt (không chỉ lần cuối), nên lint/check sau đó
  luôn thấy bản đã đúng. 2 check mới giờ chỉ còn vai trò defense-in-depth (không bao
  giờ nên fire nữa).

### Bug 3: field `_audio.voiceover` nói dối khi TTS lỗi
Trong lúc test bug 1, phát hiện thêm: `hyperframes lint` báo lỗi thật
`audio_src_not_found` cho 3 file mp3 — vì `generate-audio.mjs` set
`voiceover: scene.narration ? path : null` (dựa vào CÓ narration hay không) thay vì
dựa vào TTS có THỰC SỰ thành công hay không. Khi TTS lỗi thoáng qua (đúng bug edge-tts
"Stream closed" đã sửa ở phiên trước — bước "audio" đã báo lỗi ĐÚNG, nhưng lúc test tôi
bỏ qua lỗi đó và generate tiếp), field vẫn trỏ tới file không hề tồn tại, khiến
root-composer (và cả `enforceVoiceoverTags`) tin có audio thật cho scene không hề có.
**Fix**: `voiceover: scene.narration && result ? path : null` — chỉ set path khi
`generateVoiceover()` thực sự trả về kết quả (thành công hoặc reuse file cũ).

### Bug 4 (phát hiện thêm khi verify lại bug 3): skip-branch trả sai shape
Khi retry `/audio` sau khi sửa bug 3, phát hiện tiếp: 3 scene ĐÃ ĐÚNG trước đó
(scene_03/04/05) bị mất sạch `word_timestamps` sau khi chạy lại — dù file mp3+timing
trên đĩa vẫn nguyên vẹn, đúng dữ liệu. Nguyên nhân: nhánh "skip" (file đã tồn tại) của
`generateVoiceover()` `return existsSync(timingFile) ? JSON.parse(...) : null` — trả
thẳng ARRAY word-timestamps thô (đúng những gì được ghi vào file), nhưng caller luôn
kỳ vọng object `{wordTimestamps, voDuration}`. `array.wordTimestamps` là `undefined`
→ mọi lần retry `/audio` trên project có sẵn vài scene xong đều âm thầm làm hỏng dữ
liệu của NHỮNG SCENE ĐÃ ĐÚNG — bug tồn tại từ lâu, không liên quan riêng gì remix,
chỉ vô tình bị "chạy lại /audio nhiều lần" (chính là hành vi khuyến khích bởi tính
năng retry-rẻ mới làm) phơi ra.
**Fix**: nhánh skip giờ đọc lại đúng array, tự tính `voDuration` từ `Math.max(...end)`
của các từ, trả đúng shape `{wordTimestamps, voDuration}`.

### Verify thật — dựng lại đúng kịch bản lỗi từ đầu đến cuối, không giả lập
Remix thật → audio thật (2 scene TTS lỗi thoáng qua thật, bug 3 khiến root-composer
sau đó nhận nhầm data) → generate 6 scene thật → root thật → phát hiện đủ cả 4 bug nói
trên theo đúng thứ tự bị vấp phải. Sau khi vá xong cả 4: audio → generate lại 3 scene
bị hỏng → root → **`npx hyperframes lint` 0 lỗi thật (không còn `audio_src_not_found`),
`checkVoiceoverOverlap`/`checkVoiceoverCompleteness` đều rỗng**. Dọn project test.

### Chưa làm / theo dõi tiếp
- Mỗi attempt retry của root-composer giờ gọi `runAgent()` mới, tự bắt đầu lại từ
  `model` gốc — nếu model đó đang hết quota, MỖI attempt tốn thêm 1 lệnh gọi lãng phí
  trước khi tự fallback (thấy live: 1 lần root-composer test tốn ~180k token/8 lệnh gọi
  vì lặp lại việc hết-quota-rồi-fallback qua nhiều attempt). Có thể tối ưu bằng cách
  nhớ lại model đã fallback thành công giữa các attempt trong cùng 1 lần chạy
  `runRootComposer`, không bắt đầu lại từ model gốc mỗi attempt.

## Đã sửa — remix lỗi "function.arguments...phải là JSON" không tự phục hồi được (phiên 2026-08-02)

User báo remix (chọn model `qwen-plus-2025-04-28` tường minh, không phải do auto-
fallback) vẫn lỗi `400 InternalError.Algo.InvalidParameter: function.arguments... phải
là JSON`. Tìm đúng project thật của user bị lỗi (`output/2026-08-02/doi-van-phong-hai-
huoc`), đọc `job-status.json`'s events thay vì đoán.

**Root cause thật (chuỗi 3 bước)**:
1. Model tự sinh `function.arguments` bị lỗi JSON thật (dư ký tự sau vị trí 2361 — lỗi
   generate JSON dài, ngẫu nhiên, không phải do chọn sai model).
2. `run-agent.mjs` bắt đúng lỗi `JSON.parse` đó, báo `{ok:false, error:...}` lại cho
   model — ĐÚNG theo thiết kế cũ, nhưng tin nhắn assistant chứa `tool_calls[].function.
   arguments` bị lỗi đó vẫn nằm trong `messages` để gửi lại ở lượt sau (giữ ngữ cảnh).
3. Lượt gọi TIẾP THEO, DashScope tự validate lại toàn bộ lịch sử gửi lên, phát hiện
   field đó không phải JSON hợp lệ → từ chối thẳng cả request bằng lỗi 400 nói trên.
   Vì tin nhắn lỗi vẫn kẹt trong `messages` mãi mãi, MỌI lượt gọi sau đều bị chặn y hệt
   — hội thoại "chết cứng", không có cách nào tự phục hồi trong thiết kế cũ.

**Fix**: `run-agent.mjs` — trước khi xử lý tool result như bình thường, kiểm tra riêng
xem có `tool_call` nào có `function.arguments` không parse được không. Nếu có: **xoá
hẳn** tin nhắn assistant vừa lỗi khỏi `messages` (không gửi lại lần nữa), chèn 1 tin
nhắn `user` ngắn yêu cầu model gọi lại đúng 1 tool call với JSON hợp lệ, rồi tiếp tục
vòng lặp — hội thoại giờ sạch, không còn field lỗi nào để DashScope từ chối. Giới hạn
tối đa 2 lần retry kiểu này trước khi throw lỗi rõ ràng (tránh loop vô hạn nếu model
liên tục lỗi).

**Verify**: unit-test riêng logic phát hiện (`JSON.parse` catch) khớp đúng dạng lỗi
thật user gặp ("Unexpected non-whitespace character after JSON"). Chạy lại đúng kịch
bản remix thật (project gốc, model `qwen-plus-2025-04-28`) → thành công, `scenes.json`
sinh đúng — không tái hiện glitch JSON lần này (bản chất ngẫu nhiên, không phải lỗi cố
định lặp lại mỗi lần), nhưng logic phục hồi đã sẵn sàng cho lần sau nếu glitch tái diễn.
Dọn project test sau khi verify. Project thật của user bị lỗi cũ
(`output/2026-08-02/doi-van-phong-hai-huoc`) vẫn còn nguyên — user có thể remix lại từ
đầu (project gốc không đổi) để có bản mới không lỗi.

## Đã sửa — remix đổi font nhưng render ra vẫn font cũ (phiên 2026-08-02)

User báo: chọn font khác lúc remix, nhưng video render ra vẫn như dùng font cũ.

**Điều tra thật trên đúng project user gặp** (`output/2026-08-02/doi-van-phong-hai-
huoc-hon`, remix từ project dùng font Charm, chọn font mới là Mali):
- `video-plan.json` VÀ mọi `compositions/scene_XX.html` đều đúng
  `font-family: 'Mali'` — dữ liệu/pipeline không sai chỗ nào.
- Trích frame thật từ đúng bản render user đang xem → chữ hiện ra là 1 font sans-serif
  chung chung, KHÔNG giống Mali (tròn, viết tay) cũng KHÔNG giống Charm (thư pháp
  mảnh) — tức không phải "dùng nhầm font cũ" như user tưởng, mà là **không dùng được
  font nào cả**, rơi về font dự phòng của trình duyệt.
- Render lại độc lập lần 2 → lỗi y hệt, không phải ngẫu nhiên/mạng chập chờn.

**Nghi vấn 1 (sai)**: tưởng do `hyperframes` render capture không chờ kịp
`fonts.googleapis.com` tải xong (đúng rủi ro `hyperframes lint` cảnh báo sẵn qua
warning `google_fonts_import`). Tải sẵn font Mali về local (`assets/fonts/`), sửa
composition dùng `@font-face` local thay vì link Google Fonts. Render lại → **vẫn sai
y hệt**.

**Root cause thật**: Google Fonts phục vụ mỗi family/weight thành NHIỀU file theo
`unicode-range` riêng (subset `latin`, `latin-ext`, `vietnamese`, ...). Bước tải font
đầu tiên chỉ lấy đúng file subset **"vietnamese"** (nghĩ vậy là đủ vì cần tiếng Việt)
— nhưng subset đó CHỈ chứa glyph cho các ký tự có dấu đặc thù tiếng Việt
(ă, â, đ, ê, ô, ơ, ư và các dấu thanh), KHÔNG chứa chữ cái Latin thường (a-z, A-Z) —
những chữ đó nằm ở subset "latin" riêng. Vì đa số ký tự trong 1 câu là chữ Latin
thường, `document.fonts` báo font "loaded" đúng (file tải thành công) nhưng trình
duyệt không tìm thấy glyph phù hợp cho phần lớn ký tự nên âm thầm rơi về font hệ
thống — y hệt hiện tượng user thấy.

Verify bằng cách dựng lại y hệt bug qua Playwright: script tự viết `@font-face` chỉ
trỏ tới file subset "vietnamese" → chữ Latin thường ra sai (bold sans generic); thêm
đúng cả subset "latin" (kèm `unicode-range` riêng, đúng cơ chế browser tự chọn file
theo từng ký tự) → chữ ra ĐÚNG Mali (chấm 'i' tròn, nét chữ bo tròn đặc trưng).

**Fix cuối cùng**:
- Viết lại script tải font: lấy đủ 3 subset `latin` + `latin-ext` + `vietnamese` cho
  mỗi family/weight, lưu kèm `unicode-range` thật (copy nguyên văn từ CSS của Google)
  vào `assets/fonts/manifest.json`.
- `server/lib/fonts.mjs` viết lại — `fontFaceCss()` sinh NHIỀU rule `@font-face` (1
  rule/subset) kèm đúng `unicode-range`, đúng cơ chế Google dùng; `ensureFontCopied()`
  copy đủ mọi file subset cần vào `assets/fonts/` của từng project (idempotent, giống
  quy ước copy nhạc/SFX).
- `templates/sub-styles/image-full-focus.mjs` — bỏ hẳn `<link>` Google Fonts, dùng
  `fontFaceCss()`.
- `sub-scene-writer.mjs` — gọi `ensureFontCopied()` trước khi viết composition.

**Verify thật trên chính project user gặp lỗi**: xoá `assets/fonts/` cũ (thiếu subset),
generate lại cả 6 scene (ảnh skip, không tốn phí), ghép root, render thật → trích
frame → **xác nhận đúng font Mali (tròn, viết tay)**, khớp hệt mẫu tham chiếu đã verify
riêng. Dọn file render test, giữ nguyên 2 bản render cũ (lỗi font) của user trong
`renders/` — user có thể tự xoá qua tab History hoặc render lại để có bản đúng.

### Chưa làm / theo dõi tiếp
- Chưa cập nhật các project CŨ khác (không phải project user vừa báo) — chúng vẫn
  dùng `<link>` Google Fonts trong `compositions/*.html` đã sinh sẵn, chỉ project nào
  generate/regenerate scene SAU thời điểm fix này mới tự động dùng font local. Muốn
  sửa toàn bộ project cũ thì cần chạy lại generate cho từng scene (ảnh vẫn skip, không
  tốn phí, chỉ tốn thời gian).
- Danh sách 6 font (`Itim`, `Mali`, `Pacifico`, `Charm`, `Sriracha`, `Amatic SC`) đã
  tải đủ. Nếu sau này thêm font mới vào `FONT_OPTIONS` (Pipeline.jsx) thì phải tải
  thủ công 3 subset + cập nhật `manifest.json` trước, không tự động.

## Mới — chọn voice edge-tts (giữ voice cũ, thêm voice nam) (phiên 2026-08-02)

User chê giọng edge-tts hiện tại chưa hay, hỏi gợi ý provider khác. Đề xuất: thử đổi
voice ID miễn phí trước (rẻ nhất, không cần code mới), gợi ý thêm FPT.AI/DashScope
TTS/ElevenLabs nếu cần chất lượng cao hơn sau này. User chọn phương án 1: thêm
`vi-VN-NamMinhNeural` (giọng nam), **giữ nguyên** `vi-VN-HoaiMyNeural` (giọng nữ, mặc
định cũ) làm 1 option để chọn, không thay hẳn.

- `edge-tts.mjs`'s `synthesize()` **đã sẵn** tham số `voiceId` từ trước — chỉ thiếu
  chỗ nào truyền nó xuống. Thêm `ttsVoice` xuyên suốt: `generate-audio.mjs` (param mới,
  chỉ set `voiceId` khi có giá trị) → `routes.mjs`'s `POST /audio` → `Pipeline.jsx`
  (dropdown mới `EDGE_TTS_VOICES`, chỉ hiện khi `ttsProvider==="edge-tts"`) →
  `profiles.mjs`'s `PROFILE_FIELDS` (thêm `"ttsVoice"` để lưu/nạp lại theo profile
  kênh, giống các field khác).
- **Verify thật**: gọi thẳng `edge-tts.mjs`'s `synthesize()` với
  `voiceId: "vi-VN-NamMinhNeural"` → thành công, sinh audio thật (2.3s, 9 từ) —
  xác nhận voice ID hợp lệ trước khi tin vào UI. Playwright thật: dropdown hiện đúng 2
  lựa chọn ("HoaiMy (nữ) — mặc định", "NamMinh (nam)"), chọn được NamMinh, 0 lỗi.
- Dọn project test sau khi verify.

### Chưa làm / theo dõi tiếp
- Chưa tích hợp provider TTS chất lượng cao hơn (FPT.AI/DashScope CosyVoice/
  ElevenLabs trả phí) — chỉ mới đổi voice trong edge-tts (free). Nếu sau khi thử
  NamMinh vẫn chưa ưng, cân nhắc tích hợp 1 trong các provider đã gợi ý.

## Mới — Thư viện ảnh AI tái dùng (image library, tag-based) (phiên 2026-08-02)

User nêu: model sinh ảnh flash ~0.03$/ảnh, video 7-10 scene tốn 5-7k VNĐ, muốn giải
pháp giảm phí khi scale. Bàn kỹ trước khi code (Q&A, chưa code):
- Chọn hướng tag-based (không phải embedding) — rẻ hơn, đủ dùng vì style
  matchstick-figure vốn lặp lại vài mô-típ cảm xúc quen thuộc.
- Thêm checkbox bật/tắt + setting giới hạn số scene tái dùng tối đa.
- Thư viện PHẢI tách nhóm theo **profile kênh** (không theo raw `imageStylePrefix`
  text) — đổi phong cách (đổi profile) = nhóm khác hẳn, không lẫn ảnh 2 style khác
  nhau vào cùng video. Ảnh sinh ra khi KHÔNG chọn profile (tự gõ tay) không được lưu
  vào thư viện chung — coi là one-off.

### Kiến trúc
- `server/agents/video-planner.mjs` — thêm `IMAGE_TAG_VOCAB` (~40 tag cố định, đóng —
  không phải tag tự do, vì mục đích là so KHỚP overlap giữa các scene/video khác
  nhau, tag tự do gần như không bao giờ trùng chữ). Prompt yêu cầu model gán thêm
  field `image_tags` (2-4 tag, CHỈ chọn từ danh sách này) cho mỗi scene, cùng lúc với
  `image_prompt` (không tốn thêm lượt gọi LLM riêng). Thêm param
  `imageLibraryEnabled`/`imageLibraryMaxReuse`/`profileSlug`, ghi vào
  `video-plan.json.imageLibrary = {enabled, maxReuse, profileSlug}` — `enabled` chỉ
  thật sự `true` khi CẢ checkbox bật VÀ có `profileSlug` (ép logic ở code, không tin
  UI).
- `server/lib/image-library.mjs` (mới) — lưu trữ phẳng
  `assets/image-library/manifest.json` (mảng entry `{id, file, profileSlug, format,
  tags, prompt, createdAt}`) + file ảnh `assets/image-library/<id>.png`, giống quy
  ước `assets/music`/`assets/sfx`/`assets/fonts`.
  - `findReusableImage({profileSlug, format, tags})` — chỉ so trong đúng nhóm
    `profileSlug`+`format`, chọn entry có overlap tag CAO NHẤT, yêu cầu tối thiểu
    `MIN_TAG_OVERLAP = 2` (1 tag trùng dễ là trùng hợp ngẫu nhiên, 2+ mới đáng tin).
  - `addToLibrary(...)` — copy ảnh vừa sinh THẬT (không phải reuse/skip) vào thư
    viện, ghi entry mới. No-op nếu không có `profileSlug`.
  - `tryReserveReuseSlot(projectDir, maxReuse)` — đếm số lần đã tái dùng CỦA RIÊNG
    project này (file nhỏ `image-library-state.json` trong project dir, không phải
    thư viện chung) để tôn trọng giới hạn `maxReuse` khi bật.
- `sub-scene-writer.mjs` — trước khi gọi `generateAndSaveImage` (tốn tiền), check
  theo thứ tự: (1) file đã tồn tại trên đĩa → skip như cũ; (2) thư viện bật + tìm được
  ảnh khớp + còn slot reuse → copy từ thư viện (`image-reused` event); (3) không thì
  mới sinh ảnh thật, và nếu thư viện bật + sinh thành công thật → lưu vào thư viện
  cho các video sau.
- `routes.mjs` — `/video-plan` nhận thêm 3 param mới; `/scenes/:id/generate` (nhánh
  sub) truyền `videoPlan.imageLibrary` xuống.
- `Pipeline.jsx` — checkbox "Tìm ảnh có sẵn trong thư viện trước khi sinh mới" (disable
  nếu chưa chọn profile) + input số tối đa tái dùng (để trống = không giới hạn), chỉ
  hiện khi template="sub" hoặc visualStyle="ai-image". Cả 2 chỗ gọi
  `api.runVideoPlan` (nút bấm tay + `runAllPipeline`) đều truyền
  `imageLibraryEnabled`/`imageLibraryMaxReuse`/`profileSlug: selectedProfileSlug`.

### Verify thật end-to-end (2 project thật, không giả lập)
- Tạo profile kênh `imagelibtest` (template=sub, cùng imageStylePrefix mặc định).
- **Project A** ("Cảm giác hồi hộp khi trao mẩu giấy..."): chạy plan → audio →
  video-plan (imageLibraryEnabled=true, profileSlug=imagelibtest) → generate
  scene_01 thật (sinh ảnh AI thật, tốn phí 1 lần) → xác nhận
  `assets/image-library/manifest.json` có đúng entry mới với `profileSlug`/`tags`
  khớp.
- **Project B** ("Ký ức trao mẩu giấy tình yêu học trò ngày xưa" — cố ý gần nghĩa) —
  cùng luồng, cùng profile. `scene_01`'s `image_tags` overlap đúng 2/3 tag với entry
  của project A (`paper-note`, `memory-flashback`). Generate `scene_01` → event
  **`image-reused`** (không phải `image`/`image-skip`) → **MD5 file `assets/images/
  scene_01.png` khớp TUYỆT ĐỐI với file trong thư viện** — xác nhận không hề gọi
  DashScope sinh ảnh lần 2, tiết kiệm phí thật.
- Dọn 2 project test, thư viện test, và profile test sau khi verify.

### 2 phát hiện phụ (không liên quan tính năng này, gặp trong lúc test)
- `DASHSCOPE_MODEL=DeepSeek-V3.2` user set trong `.env` **không tồn tại thật trên
  DashScope** (`404 model_not_found`) — và vì tên này không nằm trong
  `EXPENSIVE_MODELS`/`CHEAP_MODELS` (lib/models.mjs) nên cơ chế tự fallback (đã làm ở
  phiên trước) không cứu được, lỗi thẳng ngay từ đầu. Cần user tự đổi lại `.env` hoặc
  thêm "DeepSeek-V3.2" vào danh sách fallback nếu xác nhận model đó tồn tại dưới tên
  khác trên DashScope.
- Gặp 1 lần (không tái diễn khi retry): model tự viết `video-plan.json` với 1 chuỗi
  JSON dùng nháy đơn bao 1 ký tự nháy kép literal (\`'"'\` thay vì \`"\\""\`) — làm
  hỏng cú pháp JSON của cả file. Ngẫu nhiên, không liên quan tính năng thư viện ảnh,
  chưa có validator riêng bắt lỗi này (khác hẳn 2 lỗi voiceover đã thêm check trước
  đó) — nếu tái diễn thường xuyên thì nên thêm 1 check tương tự.

### Chưa làm / theo dõi tiếp
- Chưa có UI xem/quản lý thư viện ảnh (bao nhiêu ảnh, xoá ảnh cũ, xem theo profile).
- Chưa thêm validator bắt lỗi "model viết JSON dùng nháy đơn" (phát hiện phụ ở trên).

## Đã sửa — phát hiện MỌI video từ trước tới giờ đều KHÔNG có nhạc nền (phiên 2026-08-02)

User hỏi Q&A về cải thiện âm thanh → gợi ý "chọn/nghe thử nhạc nền" → user hỏi ngược
"thư viện nhạc tôi phải tự thêm à?" → kiểm tra thật phát hiện `assets/music/` **hoàn
toàn trống** (0 file) trong workspace.

**Root cause (đã ghi sẵn trong `plan.md` từ Phase 0, không phải phát hiện mới)**:
`setup-music-library.mjs` dùng ElevenLabs Sound Generation API để tự sinh 4 bài nhạc
theo mood — nhưng gói ElevenLabs Free của user chặn tính năng này (401
`missing_permissions`), nên script chưa từng chạy thành công, thư viện chưa từng có
file nào.

**Hậu quả thật, xác nhận bằng dữ liệu**: `scenes-with-timing.json` mọi project vẫn ghi
`music_track: "assets/music/<mood>.mp3"` (tưởng có), nhưng
`generate-audio.mjs`'s bước copy chỉ copy khi `existsSync(musicSrc)` — file nguồn
không tồn tại nên không copy, project không có nhạc, và root-composer nhận ra thiếu
file nên tự bỏ hẳn track nhạc khỏi `index.html` — không có cảnh báo/lỗi nào ở bất kỳ
đâu trong suốt pipeline. **Kiểm tra thật trên project đã render trước đó xác nhận
đúng: 0 file trong `assets/music/` của project, `index.html` không có
`data-track-index="20"` nào cả** — mọi video render ra từ trước tới giờ chỉ có
voice + SFX, không hề có nhạc nền.

User tự thêm 1 file `assets/music/default.mp3` (1 bài chung, không phải đúng 4 tên
mood-specific hệ thống đang tìm) làm giải pháp tạm.

**Fix**: `generate-audio.mjs`'s bước chọn nhạc — nếu file mood-specific không tồn tại
nhưng `assets/music/default.mp3` có, tự fallback dùng `default.mp3` thay vì im lặng bỏ
qua như cũ. Phát `onEvent({type:"music-fallback"})` để hiện rõ trong live log
("Nhạc 'X' chưa có trong thư viện — dùng tạm 'default'"), không còn âm thầm mất nhạc.

**Verify thật trên project thật đã render trước đó** (`tinh-yeu-tuoi-hoc-tro-that-
trong-sang`): chạy lại `/audio` → event `music-fallback` đúng (`fluid-ambient` →
`default`), `default.mp3` copy đúng vào project. Chạy lại `/root` → `index.html` có
đúng `<audio data-track-index="20" src="assets/music/default.mp3">`. Render lại thật
→ `ffprobe` xác nhận stream audio AAC 43.4s (khớp đúng tổng thời lượng video),
`ffmpeg volumedetect` xác nhận **mean -18.3dB, max -2.6dB** — âm thanh thật, không
phải track câm. Dọn file render test.

### Chưa làm / theo dõi tiếp
- Chỉ mới có 1 bài nhạc chung (`default.mp3`) cho MỌI mood — mất đi sự đa dạng nhạc
  theo cảm xúc scene (vốn là mục đích của `MOOD_TO_MUSIC`). User cần tự thêm thêm bài
  cho từng mood (`upbeat-tech`, `cinematic-dark`, `fluid-ambient`, `technical-pulse`),
  hoặc dùng nguồn nhạc free-license khác, hoặc nâng cấp ElevenLabs.
- Các project ĐàCÓ SẴN trước fix này (render trước phiên này) vẫn không có nhạc trong
  bản render cũ — chỉ project nào chạy lại `/audio` + `/root` + render SAU fix mới có
  nhạc. Muốn sửa các video cũ thì cần chạy lại đúng 3 bước đó (không tốn phí, chỉ tốn
  thời gian).
- Đề xuất UI "chọn/nghe thử nhạc nền trước khi generate-audio" (gợi ý ban đầu của
  phiên này) — chưa làm, có thể làm sau nếu cần.

## Ghi chú — thư viện SFX cũng trống, KHÔNG ưu tiên sửa ngay (phiên 2026-08-02)

Cùng lúc phát hiện nhạc nền trống, kiểm tra luôn SFX: `assets/sfx/` **cũng hoàn toàn
trống** (thư mục còn chưa tồn tại) — cùng nguyên nhân với nhạc nền (ElevenLabs Free
chặn Sound Generation, `setup-sfx-library.mjs` chưa từng chạy thành công). Mọi video
từ trước tới giờ không có SFX nào cả (`sfx-missing` event đã có sẵn từ lâu trong
`generate-audio.mjs`, giờ hiện được trong live log, nhưng chưa ai để ý vì UI live log
mới thêm gần đây).

**Quan trọng — hệ thống chỉ nhận đúng 8 tên SFX cố định** (viết chết trong
`.agents/skills/video-planner/SKILL.md`'s bảng "SFX Timing"): \`drum-hit\`, \`whoosh\`,
\`whoosh-soft\`, \`ding\`, \`click\`, \`impact\`, \`chime\`, \`count-up-end\`. LLM CHỈ được
chọn từ đúng 8 tên này khi lên `sfx_picks` — không tự quét thư mục để biết file nào có
sẵn. Nên:
- Tải SFX từ Pixabay (hay nguồn free-license khác) rồi đặt tên **đúng y hệt** 1 trong
  8 tên trên (vd lưu thành `whoosh.mp3`, `click.mp3`...) bỏ vào `assets/sfx/` →
  hoạt động ngay, không cần sửa code.
  Muốn thêm loại SFX MỚI ngoài 8 tên này thì phải sửa `SKILL.md` để LLM biết tên mới
  tồn tại và khi nào nên dùng, không chỉ thêm file là đủ.

**User quyết định: KHÔNG ưu tiên sửa ngay** — sẽ tự tải/đặt tên SFX theo đúng 8 tên
trên sau, và cân nhắc nâng cấp ElevenLabs sau này (sẽ giải quyết cả nhạc lẫn SFX cùng
lúc nếu nâng cấp, vì cùng 1 API). Không cần code gì thêm cho việc này trừ khi user
quay lại yêu cầu.

## Mới — chọn nhạc nền + % âm lượng trên UI (phiên 2026-08-02)

User yêu cầu thêm option chọn nhạc (mặc định "default") + chọn % âm lượng nền (mặc
định 20%) ở bước Audio, tiếp nối trực tiếp việc vừa sửa bug "không có nhạc nền".

- `generate-audio.mjs` — thêm param `musicTrack` (override hẳn auto-pick theo mood
  khi có) và `musicVolume` (0-1, override `music_volume` mặc định — đổi mặc định
  cứng từ `0.18` lên `0.2` khớp đúng yêu cầu user).
- `routes.mjs` — route mới `GET /music-library` (liệt kê `assets/music/*.mp3` dùng
  chung, không theo project) cho UI biết có bài nào để chọn; `/audio` nhận thêm
  `musicTrack`/`musicVolume`, tự đổi % (0-100 từ UI) sang 0-1 trước khi gọi
  `runGenerateAudio` (giữ đúng quy ước `data-volume` 0-1 đã dùng khắp index.html).
- `Pipeline.jsx` — dropdown "Nhạc nền" (option đầu "Tự động theo mood", còn lại liệt
  kê đúng file thật trong thư viện) + input số "% âm lượng nền" (mặc định 20, min 0
  max 100), đặt ngay dưới hàng TTS trong card "Cấu hình pipeline". Thêm vào
  `profiles.mjs`'s `PROFILE_FIELDS` để lưu/nạp lại theo profile kênh.

**Verify thật**: gọi `/audio` với `musicTrack: "default"`, `musicVolume: 35` trên
project thật → `scenes-with-timing.json` ghi đúng `music_volume: 0.35`. Ghép lại root
→ `index.html` có đúng `data-volume="0.35"`. Playwright thật: dropdown hiện đúng
"default" + label dự phòng, input mặc định đúng 20.

### Chưa làm / theo dõi tiếp
- Chưa có nút "nghe thử nhạc trước khi chạy audio" (đã gợi ý trước đó, chưa làm —
  có thể ghép chung với dropdown này sau, giống cách đã làm với "nghe thử voice").
