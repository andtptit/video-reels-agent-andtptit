---
name: content-planner
description: Từ ý tưởng thô → viết master_content.md như một screenplay liền mạch → cắt cảnh theo ý nghĩa → output scenes.json. Dùng ở Bước 2, SAU KHI đã chạy new-video.mjs. Lưu cả hai file vào project folder.
---

# Content Planner

Skill này làm duy nhất một việc: biến ý tưởng thành **nội dung có thể nói được** rồi **chia thành các cảnh có ý nghĩa**. Không làm visual, không làm animation — đó là việc của video-planner.

---

## Bước 1 — Xác nhận 3 thứ

Hỏi tối đa 3 câu nếu chưa có:

1. **Đối tượng xem**: Ai? Họ đang gặp vấn đề gì?
2. **Platform + chiều**: 9:16 (Reels/TikTok) hay 16:9 (YouTube)?
3. **Tổng thời lượng mong muốn**: Ngắn (20–30s), vừa (30–60s), dài (60–90s)?

---

## Bước 2 — Viết master_content.md

**Viết như screenplay, không phải slide deck.**

Master content là một đoạn văn liền mạch — như đang nói chuyện với một người. Không có heading, không có bullet point, không có "Bước 1:", "Bước 2:". Chỉ có lời nói tự nhiên.

**Nguyên tắc:**
- Mỗi câu phải xứng đáng có mặt — nếu cắt đi mà ý vẫn đủ thì cắt
- Không giải thích khi có thể show — "3 tiếng mỗi ngày" tốt hơn "tốn rất nhiều thời gian"
- Số liệu cụ thể tốt hơn tính từ mơ hồ — "15 giờ/tuần" tốt hơn "tiết kiệm nhiều thời gian"
- Hook câu đầu tiên phải gây chú ý trong 2 giây — bold claim, số liệu shock, hoặc câu hỏi cắt thẳng vào pain
- **Viết HOÀN TOÀN bằng tiếng Việt** — không tự chèn từ/cụm tiếng Anh (kể cả từ thông
  dụng như "content", "check", "step") trừ khi bản thân chủ đề/tên riêng bắt buộc phải
  giữ nguyên (ví dụ tên sản phẩm công nghệ nếu chủ đề đúng là về công nghệ đó). Khi
  phân vân, luôn chọn từ tiếng Việt tương đương thay vì từ tiếng Anh.

**Template structure (không phải format cứng, là hướng dẫn):**

```
[Hook — câu đầu gây dừng lại]
[Pain — cụ thể, không chung chung]
[Bridge — "Có một cách khác"]
[Value — gì, làm thế nào]
[Proof — số liệu, kết quả]
[CTA — một hành động duy nhất]
```

**Ví dụ TỆ:**
> "Ngày nay, marketing rất quan trọng với doanh nghiệp. Nhiều người tốn thời gian viết bài quảng cáo. Claude AI có thể giúp bạn. Có 3 bước để sử dụng. Bước 1 là tạo tài khoản. Hãy thử ngay."

**Ví dụ TỐT:**
> "Bạn đang tốn 3 tiếng mỗi ngày chỉ để viết bài quảng cáo? Thuê người thì tốn triệu. Tự viết thì kiệt sức. Claude AI giải quyết cả hai — một lần cấu hình, nó tự chạy mãi. Không cần biết lập trình. Không cần đăng ký thêm. Miễn phí hoàn toàn. 15 giờ tiết kiệm mỗi tuần — bắt đầu ngay hôm nay, link trong bio."

(Ví dụ trên nhắc "Claude AI" vì bản thân chủ đề là về công cụ đó — một chủ đề khác (ví
dụ đời sống gia đình, làm đẹp) sẽ không có bất kỳ từ tiếng Anh nào xuất hiện.)

**Lưu vào**: `{project-path}/master_content.md`

---

## Bước 3 — Cắt cảnh theo ý nghĩa

Đọc lại master_content và tìm **điểm cắt tự nhiên**:

### Khi nào cắt cảnh?
- Chuyển chủ đề (từ pain sang solution)
- Thay đổi cảm xúc (từ tức giận sang hy vọng)
- Một ý hoàn chỉnh đã được truyền đạt
- Sự ngừng nghỉ tự nhiên trong lời nói

### Khi nào KHÔNG cắt?
- Giữa chừng một ý đang xây dựng
- Khi câu sau phụ thuộc trực tiếp vào câu trước
- Khi cắt sẽ làm mất context

### Độ dài cảnh
- Tối thiểu: 4s (đủ để animation enter và viewer đọc)
- Lý tưởng: 5–10s
- Tối đa: 15s (nếu nội dung phức tạp cần thêm thời gian)
- Nếu VO tự nhiên ngắn hơn 4s → gộp với cảnh liền kề

---

## Bước 4 — Output scenes.json

Lưu vào `{project-path}/scenes.json`:

```json
{
  "master_content": "master_content.md",
  "platform": "9:16",
  "total_estimated_duration": 30,
  "scenes": [
    {
      "sceneId": "scene_01",
      "narration": "[câu nói chính xác từ master_content — không viết lại]",
      "meaning": "[một câu mô tả MỤC ĐÍCH của cảnh này trong narrative]",
      "estimated_duration": 5,
      "mood_hint": "explosive | cinematic | snappy | technical | fluid",
      "is_hook": true
    },
    {
      "sceneId": "scene_02",
      "narration": "...",
      "meaning": "...",
      "estimated_duration": 8,
      "mood_hint": "cinematic",
      "is_hook": false
    }
  ]
}
```

**Lưu ý quan trọng:**
- `narration` phải là trích dẫn **nguyên văn** từ master_content — không paraphrase
- `meaning` là WHY cảnh này tồn tại trong narrative (một câu)
- `estimated_duration` chỉ để tham khảo — duration thực sẽ do VO quyết định
- `mood_hint` gợi ý năng lượng cảm xúc, video-planner sẽ dùng để chọn animation style

---

## Checklist trước khi output

- [ ] master_content.md viết như nói chuyện, không có header hay bullet point?
- [ ] Câu đầu tiên có thể gây dừng scroll trong 2 giây không?
- [ ] Có số liệu cụ thể thay vì tính từ chung chung không?
- [ ] Mỗi scene có đúng một ý chính không?
- [ ] `narration` là nguyên văn từ master_content không?
- [ ] Tổng estimated_duration hợp lý với platform không?
