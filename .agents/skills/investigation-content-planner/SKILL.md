---
name: investigation-content-planner
description: Từ 1 chủ đề điều tra/vụ việc thô → viết master_content.md theo cấu trúc điều tra (bí ẩn → dòng thời gian → bằng chứng → hệ luỵ) → cắt cảnh theo ý nghĩa → output scenes.json. Thay thế content-planner cho style "Bảng điều tra" (investigation_board) — dùng khi user chọn tab "Bảng điều tra". Lưu cả hai file vào project folder.
---

# Investigation Content Planner

Skill này giống `content-planner` ở shape output (`master_content.md` + `scenes.json`)
nhưng khác hẳn ở CẤU TRÚC KỂ CHUYỆN — kể theo mạch điều tra/vụ việc có thật (kiểu true-
crime/phóng sự điều tra), không phải mạch bán hàng/thuyết phục (Hook→Pain→Bridge→Value→
Proof→CTA của content-planner). Không làm visual — đó là việc của video-planner.

---

## Bước 1 — Xác nhận 3 thứ

Hỏi tối đa 3 câu nếu chưa có:

1. **Đối tượng xem**: Ai? Họ quan tâm gì ở vụ việc này?
2. **Platform + chiều**: 9:16 (Reels/TikTok) hay 16:9 (YouTube)?
3. **Tổng thời lượng mong muốn**: Ngắn (20–30s), vừa (30–60s), dài (60–90s)?

---

## Bước 2 — Viết master_content.md theo mạch điều tra

**Viết như 1 đoạn phóng sự kể chuyện, không phải slide deck.** Liền mạch, không heading,
không bullet point, không "Bước 1:", "Bước 2:".

**Cấu trúc gợi ý (không phải khuôn cứng):**

```
[Mở đầu bí ẩn — 1 câu hỏi hoặc chi tiết lạ khiến người xem dừng lại]
[Bối cảnh — ai/cái gì/ở đâu, giới thiệu ngắn gọn]
[Dòng thời gian — các mốc sự kiện theo trình tự, mỗi mốc 1 chi tiết cụ thể]
[Bằng chứng/phát hiện — số liệu, tài liệu, lời khai cụ thể, càng chi tiết càng đáng tin]
[Hệ luỵ/ý nghĩa — chuyện này ảnh hưởng gì, tại sao người xem nên quan tâm]
[Kết — câu chốt gợi suy nghĩ, KHÔNG cần CTA bán hàng như content-planner thường]
```

**Nguyên tắc:**
- Ưu tiên chi tiết CỤ THỂ (ngày tháng, con số, tên riêng nếu công khai) hơn mô tả
  chung chung — "3 tháng 4 năm 2016" tốt hơn "một ngày nọ".
- Giọng điều tra: khách quan, dồn dập, không thiên vị lộ liễu — để bằng chứng tự nói.
- Câu đầu tiên phải tạo bí ẩn/tò mò trong 2 giây — 1 câu hỏi, 1 con số gây sốc, hoặc 1
  chi tiết trái ngược trực giác.
- KHÔNG bịa số liệu/sự kiện — nếu chủ đề do user cung cấp không đủ chi tiết thật, viết
  chung chung/khái quát thay vì tự sáng tác chi tiết giả làm như có thật.
- **Viết HOÀN TOÀN bằng tiếng Việt** — không tự chèn từ/cụm tiếng Anh trừ khi bản thân
  vụ việc/tên riêng bắt buộc phải giữ nguyên (ví dụ tên công ty/thương hiệu nước ngoài
  thật). Khi phân vân, luôn chọn từ tiếng Việt tương đương.

**Ví dụ TỆ** (giọng bán hàng, không phải điều tra):
> "Bạn có biết công ty này rất đáng ngờ không? Họ đã làm nhiều điều sai trái. Hãy cùng
> tìm hiểu ngay!"

**Ví dụ TỐT** (cụ thể, đúng mạch điều tra):
> "Tháng 4 năm 2016, 11.5 triệu tài liệu bị rò rỉ cùng lúc — lớn gấp 1500 lần vụ
> WikiLeaks. Nguồn: 1 công ty luật nhỏ ở Panama, ít ai từng nghe tên. Bên trong là hồ sơ
> của hơn 214.000 công ty vỏ bọc, liên quan tới hàng chục nguyên thủ quốc gia. Không ai
> biết chính xác ai đã làm rò rỉ — chỉ biết người đó ký tên 'John Doe'."

**Lưu vào**: `{project-path}/master_content.md`

---

## Bước 3 — Cắt cảnh theo ý nghĩa

Giống hệt quy tắc content-planner:

### Khi nào cắt cảnh?
- Chuyển mốc thời gian/chuyển giai đoạn của vụ việc
- Chuyển từ bối cảnh sang bằng chứng, hoặc từ bằng chứng sang hệ luỵ
- Một chi tiết/bằng chứng đã được trình bày trọn vẹn
- Sự ngừng nghỉ tự nhiên trong lời kể

### Khi nào KHÔNG cắt?
- Giữa chừng 1 chuỗi số liệu/bằng chứng đang xây dựng
- Khi câu sau phụ thuộc trực tiếp vào câu trước (vd giải thích tiếp 1 con số vừa nêu)

### Độ dài cảnh
- Tối thiểu: 4s, lý tưởng: 5–10s, tối đa: 15s
- VO tự nhiên ngắn hơn 4s → gộp với cảnh liền kề

---

## Bước 4 — Output scenes.json

**Shape giống HỆT content-planner** — video-planner (bước sau) sẽ tự thêm các field
ảnh/nhãn riêng cho style "Bảng điều tra", KHÔNG phải việc của bước này:

```json
{
  "master_content": "master_content.md",
  "platform": "9:16",
  "total_estimated_duration": 30,
  "scenes": [
    {
      "sceneId": "scene_01",
      "narration": "[câu nói chính xác từ master_content — không viết lại]",
      "meaning": "[một câu mô tả MỤC ĐÍCH của cảnh này trong mạch điều tra]",
      "estimated_duration": 5,
      "mood_hint": "explosive | cinematic | snappy | technical | fluid",
      "is_hook": true
    }
  ]
}
```

**Lưu ý quan trọng:**
- `narration` phải là trích dẫn **nguyên văn** từ master_content — không paraphrase.
- `meaning` là WHY cảnh này tồn tại trong mạch điều tra (vd "giới thiệu mốc thời gian
  đầu tiên", "trình bày bằng chứng chính").
- Đa số cảnh nên có `mood_hint: "cinematic"` hoặc `"technical"` (phù hợp giọng điều
  tra, khách quan) — hạn chế `"explosive"`/`"snappy"` trừ đoạn mở đầu gây chú ý.

---

## Checklist trước khi output

- [ ] master_content.md kể theo mạch điều tra (bí ẩn → timeline → bằng chứng → hệ luỵ),
      không phải mạch bán hàng?
- [ ] Câu đầu tiên có tạo bí ẩn/tò mò trong 2 giây không?
- [ ] Có chi tiết cụ thể (ngày tháng, số liệu) thay vì mô tả chung chung không?
- [ ] Không bịa số liệu/sự kiện không có căn cứ từ chủ đề user cung cấp?
- [ ] `narration` là nguyên văn từ master_content không?
