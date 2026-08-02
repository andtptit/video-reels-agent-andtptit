# Video Reels Agent — Workspace Guide

Workspace tạo short-form video tự động bằng AI. Stack: ElevenLabs (TTS + SFX + music) + HyperFrames (render HTML→MP4).

---

## Workflow

```
Ý tưởng
  │
  ▼
[1] node scripts/new-video.mjs
      → Tạo project tại output/YYYY-MM-DD/{slug}/video/
      → Copy DESIGN.md vào project
  │
  ▼
[2] /content-planner  (Claude skill)
      → Đọc ý tưởng
      → Viết master_content.md  — screenplay liền mạch, KHÔNG phân cấp theo bước
      → Cắt cảnh theo ý nghĩa   — mỗi cảnh 5–15s, một ý, một cảm xúc
      → Output: scenes.json     — danh sách cảnh với narration + meaning
  │
  ▼
[3] node --env-file=.env scripts/generate-audio.mjs output/…/video
      → Đọc scenes.json
      → ElevenLabs TTS (eleven_turbo_v2_5, voice 3VnrjnYrskPMDsapTr8X)
      → assets/audio/*.mp3 + word timestamps
      → Copy SFX + music từ workspace library vào project
      → Output: scenes-with-timing.json  (có vo_duration per scene)
  │
  ▼
[4] /video-planner  (Claude skill)
      → Đọc DESIGN.md + scenes-with-timing.json
      → Viết visual_brief chi tiết cho từng cảnh
      → Output: video-plan.json  (visual_brief + elements + sfx_picks per scene)
  │
  ▼
[5] Parallel agents — một agent per cảnh
      → Mỗi agent nhận: video-plan.json[scene] + DESIGN.md + /hyperframes skill
      → Viết compositions/scene_XX.html
      → Gọi song song để tiết kiệm thời gian
  │
  ▼
[6] Viết root index.html
      → Atmosphere (bg-dots, bg-glow, corners) — tất cả tracks 0–6, full duration
      → Background music — track 20
      → Voiceover per scene — track 21 (reuse, no overlap)
        data-start = thời điểm scene bắt đầu (tính từ vo_duration + 0.5s buffer)
      → Scene clips — tracks 10–11 alternating
        data-duration = vo_duration + 0.5s (không phải thời gian kế hoạch)
      → Crossfade transitions trong GSAP root timeline
  │
  ▼
[7] npx hyperframes lint && npx hyperframes validate --no-contrast
      → Fix errors trước khi render
  │
  ▼
[8] npx hyperframes render --no-experimental-fast-capture
      → Output: renders/*.mp4
      → Cờ --no-experimental-fast-capture: tránh 1 lỗi hiếm gặp (~1/287 frame) — mảng
        sáng chèn vào lớp shade tối dưới đáy scene "sub", trùng đúng lúc chunk phụ đề
        đổi (DOM vừa mutate) → race condition trong capture mode mặc định của macOS
        (đọc DOM paint record thay vì chụp screenshot). Đã verify: bật cờ này lint lại
        287 frame, 0 lỗi so với 1 lỗi khi không tắt (xem plan.md).
```

---

## Scripts

| Lệnh | Tác dụng |
|---|---|
| `node scripts/new-video.mjs` | Tạo project mới |
| `node --env-file=.env scripts/generate-audio.mjs <project-path>` | TTS + copy assets |
| `node --env-file=.env scripts/setup-sfx-library.mjs` | Tạo SFX library (một lần) |
| `node --env-file=.env scripts/setup-music-library.mjs` | Tạo music library (một lần) |

---

## Skills

| Skill | Khi nào dùng |
|---|---|
| `/content-planner` | Bước 2: idea → master_content.md → scenes.json |
| `/video-planner` | Bước 4: scenes-with-timing.json → video-plan.json |
| `/hyperframes` | Bước 5: visual_brief → compositions/scene_XX.html |
| `/hyperframes-cli` | lint, validate, preview, render |

> Scene-composer không còn tồn tại — dùng `/hyperframes` trực tiếp với visual_brief.

---

## Cấu trúc Project

```
output/YYYY-MM-DD/{slug}/video/
  ├── DESIGN.md                ← copy từ root workspace
  ├── master_content.md        ← screenplay liền mạch
  ├── scenes.json              ← scene list (output của content-planner)
  ├── scenes-with-timing.json  ← sau generate-audio (có vo_duration)
  ├── video-plan.json          ← output của video-planner
  ├── index.html               ← root composition
  ├── compositions/
  │   └── scene_XX.html        ← per-scene sub-composition
  ├── assets/
  │   ├── audio/               ← TTS voiceover + timing JSON
  │   ├── sfx/                 ← copied từ workspace library
  │   └── music/               ← copied từ workspace library
  └── renders/
      └── *.mp4
```

---

## Conventions Bắt Buộc

### Timing (quan trọng nhất)
- Scene `data-duration` = `vo_duration + 0.5s` — KHÔNG dùng duration ước tính từ kế hoạch
- Voiceover `data-start` = thời điểm scene bắt đầu trong timeline root
- Crossfade: 0.3s overlap giữa các scene, `tl.set` hard kill ngay sau fade

### Audio tracks
- Tracks 0–6: atmosphere (bg-dots, bg-glow, scanlines, 4 corners)
- Track 20: background music (volume 0.18)
- Track 21: voiceover (reuse, no time overlap)
- Tracks 30+: SFX — mỗi scene dùng range riêng (scene01: 30-31, scene02: 32-33...)

### HyperFrames
- Sub-composition CSS selector: `#scene-01` — KHÔNG dùng `[data-composition-id="..."]`
- Class prefix per scene: `.s1-`, `.s2-`, `.s3-`...
- Sau mỗi lần viết HTML: `npx hyperframes lint` phải `0 errors, 0 warnings`
- `repeat: Math.ceil(...)` — KHÔNG bao giờ `repeat: -1`

### Format
- 16:9: `data-width="1920" data-height="1080"`, body `1920px × 1080px`
- 9:16: `data-width="1080" data-height="1920"`, body `1080px × 1920px`

---

## Web UI thay thế (DashScope) — dùng khi hết credit Claude

Workflow trên là cách chạy chính qua Claude Code. Có thêm 1 nhánh song song trong
`server/` + `web/`: cùng pipeline (idea → content-planner → audio → video-planner →
scene-writer → root-composer → render), nhưng bước [2],[4],[5],[6] chạy bằng agent gọi
DashScope (Qwen) qua HTTP thay vì Claude Code, có UI web để thao tác. Mục đích: tiết
kiệm chi phí khi không cần dùng Claude, không thay thế workflow chính.

```
cd server && npm install && npm start   # API tại :3001, cần DASHSCOPE_API_KEY trong .env
cd web    && npm install && npm run dev # UI tại :5173
```

Chi tiết đầy đủ (kiến trúc, model đang dùng, bug đã gặp, việc còn thiếu — Phase 4 tích
hợp ảnh AI) nằm ở [`plan.md`](plan.md), không lặp lại ở đây.

---

## Environment Variables (.env)

```
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=3VnrjnYrskPMDsapTr8X

# TTS free fallback (ElevenLabs Free plan chặn TTS-qua-API + Sound Generation)
TTS_PROVIDER=edge-tts
EDGE_TTS_VOICE=vi-VN-HoaiMyNeural

# Bắt buộc cho nhánh Web UI (server/) — xem plan.md
DASHSCOPE_API_KEY=...
DASHSCOPE_MODEL=qwen3.6-plus
DASHSCOPE_MODEL_CHEAP=qwen3.7-flash
```

Xem `.env.example` để có bản đầy đủ kèm giải thích từng biến.
