# Video Reels Agent

Workspace tạo short-form video tự động bằng AI: ElevenLabs/Edge TTS (giọng đọc) +
HyperFrames (render HTML → MP4). Xem [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md)
để có workflow đầy đủ từng bước.

## Cài đặt

```bash
cp .env.example .env   # điền ELEVENLABS_API_KEY và/hoặc DASHSCOPE_API_KEY
```

Có 2 cách chạy pipeline, dùng chung `.env` và chung dữ liệu project trong `output/`:

### 1. Qua Claude Code (chính)

Không cần cài gì thêm ngoài Node. Mở workspace này trong Claude Code, làm theo workflow
trong [`CLAUDE.md`](CLAUDE.md) (skill `/content-planner`, `/video-planner`, `/hyperframes`).

### 2. Qua Web UI (DashScope) — dùng khi hết credit Claude

Pipeline tương đương nhưng chạy bằng agent gọi DashScope (Qwen) qua HTTP, có giao diện
web. Cần cài dependency riêng cho từng phần trước khi chạy lần đầu:

```bash
cd server && npm install   # thiếu bước này sẽ lỗi ERR_MODULE_NOT_FOUND: msedge-tts
cd ../web && npm install
```

Chạy (2 terminal riêng):

```bash
cd server && npm start      # API tại http://localhost:3001
cd web    && npm run dev    # UI tại http://localhost:5173
```

Chi tiết kiến trúc, model đang dùng, bug đã gặp/đã vá, và phần chưa làm — xem
[`plan.md`](plan.md).

## Cấu trúc

```
scripts/    CLI gốc (new-video, generate-audio, setup-sfx/music-library)
server/     Backend cho Web UI — agent DashScope + REST API + job queue
web/        Frontend Web UI (Vite + React)
output/     Project video đã/đang tạo (output/YYYY-MM-DD/{slug}/video/)
.agents/    Claude Code skills (content-planner, video-planner, hyperframes...)
```
