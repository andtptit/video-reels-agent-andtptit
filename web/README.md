# Video Reels Agent — Web UI

Frontend cho nhánh Web UI (DashScope) của video-reels-agent — xem
[`../README.md`](../README.md) và [`../plan.md`](../plan.md) để hiểu bối cảnh và kiến
trúc đầy đủ. Vite + React, không router, không state library (1 project = 1 trang, tiến
độ giữ trong `localStorage`).

## Chạy

Cần backend (`../server/`) đã chạy ở `http://localhost:3001` trước.

```bash
npm install
npm run dev   # http://localhost:5173
```

`VITE_API_BASE` (mặc định `http://localhost:3001`) chỉnh trong `.env` của thư mục này
nếu backend chạy ở port/host khác.
