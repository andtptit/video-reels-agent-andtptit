---
name: video-planner
description: Từ scenes-with-timing.json → xác định content shape → viết visual_brief chi tiết → output video-plan.json. Dùng ở Bước 4, SAU KHI generate-audio đã chạy. Skill cốt lõi quyết định chất lượng visual — 80% tập trung vào "ý tưởng có hình dạng gì" và "viewer thấy + cảm gì".
---

# Video Planner

Skill này làm một việc: biến narration + timing thành **bản thiết kế visual chính xác** để agent HyperFrames render ngay, không cần đoán thêm.

---

## Đọc trước khi làm

1. Đọc `DESIGN.md` — màu, font, motion defaults
2. Đọc `scenes-with-timing.json` — narration, `_audio.vo_duration`, word timestamps, timing_anchors

`_audio.scene_duration` = `vo_duration + 0.5s` — đây là **thời gian thực của scene**, dùng làm `duration` trong output. Không thay đổi.

---

## Bước 1 — Xác định Content Shape TRƯỚC

**Câu hỏi quan trọng nhất không phải "nội dung nói gì" mà là "ý tưởng này có HÌNH DẠNG gì?"**

Đọc narration của cảnh → phân loại vào một trong các shape dưới đây → shape đó quyết định toàn bộ visual structure.

---

### Nhóm 1 — Flow & Process

| Shape | Khi nào dùng | Mô tả visual |
|---|---|---|
| `linear-flow` | Các bước nối tiếp nhau | A → B → C → D theo chiều ngang hoặc dọc, mỗi node nối bằng arrow |
| `divergent-flow` | Một nguồn tạo ra nhiều kết quả | Node trung tâm ở trên/giữa, các nhánh tỏa ra phía dưới/xung quanh |
| `convergent-flow` | Nhiều thứ gộp lại thành một | Nhiều node ở trên, các lines chụm vào một node kết quả bên dưới |
| `hourglass-flow` | Nhiều → lọc → một → mở rộng | Phễu thu hẹp rồi nở ra — dùng khi có bước lọc/tổng hợp ở giữa |
| `cycle-flow` | Quy trình lặp lại không ngừng | Vòng tròn khép kín, mỗi node có arrow sang node tiếp theo |
| `parallel-flow` | Nhiều việc xảy ra đồng thời | Các track chạy song song, cùng start/end nhưng độc lập nhau |
| `decision-tree` | Rẽ nhánh theo điều kiện | Diamond ở giữa, nhánh YES/NO rẽ ra hai hướng khác nhau |
| `funnel` | Lọc từ nhiều → ít → một kết quả tinh chất | Hình phễu, từng tầng thu hẹp, tầng cuối là essence |

**Ví dụ áp dụng:**
- "Claude Code nhận ý tưởng → tạo ra 5 loại software" → `divergent-flow`
- "5 loại software → đều ra tiền" → `convergent-flow`
- Kết hợp: Claude Code → [5 software] → TIỀN = `divergent` + `convergent` nối tiếp → **hourglass**

---

### Nhóm 2 — Comparison & Contrast

| Shape | Khi nào dùng | Mô tả visual |
|---|---|---|
| `two-column` | A vs B, cũ vs mới, có vs không | Hai cột đứng cạnh nhau, header rõ ràng |
| `before-after` | Transformation, cải thiện rõ rệt | Split đôi màn hình — trái (trước, xấu), phải (sau, tốt) |
| `spectrum` | Mức độ từ thấp → cao, từ tệ → tốt | Thanh gradient ngang, mũi tên hoặc điểm đánh dấu vị trí hiện tại |
| `venn` | Hai khái niệm có điểm giao nhau | Hai vòng tròn chồng, vùng giao là điểm chung quan trọng |
| `quadrant` | Phân loại theo 2 trục độc lập | Ma trận 2×2, trục X và Y rõ ràng, 4 góc = 4 loại |
| `stack-rank` | Ưu tiên theo thứ tự quan trọng | Danh sách xếp chồng, item #1 to nhất ở trên cùng |

---

### Nhóm 3 — Data & Stats

| Shape | Khi nào dùng | Mô tả visual |
|---|---|---|
| `big-number` | Một con số gây shock, cần viewer dừng lại | Số khổng lồ chiếm 50–70% canvas, label context nhỏ phía dưới |
| `counter` | Đếm lên/xuống, cảm giác realtime | Số thay đổi động trong scene (animate từ 0 → target) |
| `progress-bar` | Phần trăm hoàn thành, mức độ | Thanh fill từ 0% → X%, label % hiện thị khi fill |
| `bar-chart` | So sánh nhiều giá trị cùng loại | Các cột cao thấp cạnh nhau, cột quan trọng highlight màu |
| `growth-arrow` | Xu hướng tăng trưởng theo thời gian | Đường cong đi lên + số liệu tại điểm cuối |
| `pie-donut` | Tỷ lệ phần trăm của tổng thể | Hình tròn chia phần, một phần được tách ra/highlight |
| `dashboard` | Nhiều metric cùng một lúc | Cards nhỏ xếp theo grid, mỗi card = một số liệu kèm label |

---

### Nhóm 4 — Structure & Hierarchy

| Shape | Khi nào dùng | Mô tả visual |
|---|---|---|
| `pyramid` | Tầm quan trọng từ nền → đỉnh | Hình tam giác, tầng dưới rộng = nền tảng, đỉnh = cao nhất |
| `concentric` | Lớp core → outer layers | Vòng tròn đồng tâm, trong cùng = quan trọng nhất |
| `network` | Nhiều node kết nối nhau không theo thứ bậc | Web/spider, các node nối bằng đường, node trung tâm lớn hơn |
| `mind-map` | Một chủ đề trung tâm + nhiều nhánh ý tưởng | Node center + 4–6 nhánh xung quanh, mỗi nhánh có label |
| `grid-cards` | Nhiều item ngang hàng, không có thứ bậc | Lưới ô vuông hoặc chữ nhật, mỗi ô = một item bình đẳng |
| `timeline` | Sự kiện theo thứ tự thời gian | Đường ngang (hoặc dọc), các mốc xuất hiện lần lượt trên trục |
| `org-chart` | Cấu trúc tổ chức, phân cấp rõ ràng | Tree từ trên xuống, cấp trên → cấp dưới |

---

### Nhóm 5 — Narrative Moments

| Shape | Khi nào dùng | Mô tả visual |
|---|---|---|
| `title-card` | Hook, bold claim, CTA, tên chủ đề | Headline chiếm canvas, tối giản, high contrast |
| `spotlight` | Nhấn mạnh một vấn đề/giải pháp duy nhất | Element trung tâm sáng, xung quanh tối hoặc mờ |
| `reveal` | Bí mật được hé lộ dần dần | Element ẩn → xuất hiện từng phần, tạo anticipation |
| `checklist` | Từng bước được xác nhận theo thứ tự | Các item, dấu ✓ hoặc icon xuất hiện lần lượt khi narration nhắc |
| `quote-card` | Câu nói nổi bật, testimonial, trích dẫn | Text lớn căn giữa + dấu "" + tên/nguồn nhỏ phía dưới |
| `step-by-step` | 3–5 bước rõ ràng, viewer làm theo được | Cards xếp thẳng hàng (ngang/dọc tùy format), có số thứ tự |
| `cta` | Kêu gọi hành động kết thúc video | Badge/button nổi bật + urgency text + halo glow |

---

## Bước 2 — Áp dụng Shape vào Visual Brief

Sau khi chọn shape, viết `visual_brief` theo template 5 phần:

```
CONTENT SHAPE: [tên shape đã chọn + lý do ngắn gọn]

HERO FRAME: [Mô tả trạng thái đỉnh cao — khi mọi thứ đã vào vị trí đầy đủ.
             Viewer nhìn vào frame này phải hiểu ngay thông điệp chính.]

ENTRANCE: [Element nào xuất hiện trước, theo sau là gì.
           Dùng motion vocabulary: slam, bloom, drift, snap, cascade, draw-on, sweep, pulse, burst, float.
           Timing stagger: "0.2s sau", "ngay khi node xuất hiện", "đồng thời với ding"]

FOCAL MOMENT: [Một khoảnh khắc duy nhất — timestamp + điều xảy ra.
               Thường sync với SFX hoặc từ quan trọng trong VO.
               "Tại Xs: [element] [action] — đây là đỉnh cảm xúc của cảnh."]

VIEWER EMOTION: [Viewer cảm gì sau cảnh này — PHẢI cụ thể.
                 TỐT: "Viewer thấy: 'Ồ, mình chưa biết điều này'"
                 TỆ: "Viewer cảm thấy ấn tượng"]

VO SYNC: [Element nào xuất hiện/highlight khi từ nào được nói.
          Dùng timing_anchors từ scenes-with-timing.json nếu có.]
```

---

## Bước 3 — Ví dụ Visual Brief tốt theo từng Shape

### `divergent-flow` — "Claude Code → nhiều ý tưởng phần mềm"

> CONTENT SHAPE: divergent-flow — một nguồn (Claude Code) tạo ra nhiều output (các ý tưởng).
>
> HERO FRAME: Node "Claude Code" glow xanh ở trên cùng center. Bên dưới, 4 nodes tỏa ra: "Web App", "Mobile App", "Bot", "API Tool" — mỗi node là một card nhỏ với icon. SVG lines nối từ Claude Code xuống từng card. Toàn bộ cấu trúc chiếm 70% canvas.
>
> ENTRANCE: Node Claude Code bloom từ center tại 0.2s. Tại 0.8s: line đầu tiên draw-on xuống → card "Web App" snap in. Lần lượt 0.5s mỗi nhánh, cascade từ trái sang phải. Mỗi ding SFX = một nhánh hoàn chỉnh.
>
> FOCAL MOMENT: Tại 3.0s (khi cả 4 nhánh đã visible): node Claude Code pulse mạnh + glow burst — như hệ thống vừa hoàn tất khởi động.
>
> VIEWER EMOTION: "Claude Code không chỉ viết code — nó đang generate ra hẳn một ecosystem."
>
> VO SYNC: Khi VO nói "Web App" → card Web App xuất hiện đúng lúc.

---

### `hourglass-flow` — "Claude Code → ý tưởng → TIỀN"

> CONTENT SHAPE: hourglass-flow — divergent (Claude Code → nhiều ý tưởng) kết hợp convergent (nhiều ý tưởng → một kết quả: TIỀN).
>
> HERO FRAME: Trên cùng: node "Claude Code" glow. Giữa: 3 nodes "Ý tưởng 1/2/3" xếp ngang. Dưới cùng: node lớn "TIỀN 💰" với glow mạnh nhất. SVG lines tạo hình hourglass — tỏa ra rồi chụm lại.
>
> ENTRANCE: Claude Code bloom tại 0.3s. Lines tỏa xuống draw-on → 3 ý tưởng cascade snap in (0.5s, 1.0s, 1.5s). Pause 0.5s. Sau đó 3 lines convergent draw-on chụm xuống → node TIỀN bloom lớn tại điểm cuối.
>
> FOCAL MOMENT: Tại 3.5s: node TIỀN đạt full size + glow burst mạnh + đổi màu sáng hơn — đây là payoff của toàn bộ cảnh.
>
> VIEWER EMOTION: "Tôi hiểu rồi — đây không phải tool code, đây là tool kiếm tiền."
>
> VO SYNC: Khi VO nói "tiền" — node TIỀN vừa xuất hiện hoặc vừa burst.

---

### `big-number` — "15 giờ tiết kiệm mỗi tuần"

> CONTENT SHAPE: big-number — một con số cần viewer dừng lại và thấm vào.
>
> HERO FRAME: "15" chiếm 55% canvas chiều dọc, neon green, glow rực. Bên phải: "GIỜ/TUẦN" in thẳng đứng nhỏ hơn. Bên dưới: "Thời gian bạn sẽ lấy lại" — trắng, mờ nhẹ. Background radial glow tập trung vào số.
>
> ENTRANCE: "15" impact slam từ scale 0 tại 0.1s — không drift, không fade — là cú đấm thẳng. "GIỜ/TUẦN" sweep từ phải vào 0.3s sau. Label phía dưới drift up 0.5s sau.
>
> FOCAL MOMENT: Tại 0.5s (impact SFX): "15" scale pulse 1.08 → về 1.0 với elastic — như số đang thở.
>
> VIEWER EMOTION: "15 giờ — tức là gần 2 ngày làm việc mỗi tuần. Mình đang lãng phí điều đó."
>
> VO SYNC: Số "15" xuất hiện 0.2s trước khi VO nói "15 giờ" — visual dẫn trước audio.

---

### `checklist` — "3 bước để bắt đầu"

> CONTENT SHAPE: checklist — viewer cần thấy từng bước được tick off theo narration.
>
> HERO FRAME: 3 rows xếp dọc, mỗi row: số thứ tự neon green + icon + text + dấu ✓ (xuất hiện sau cùng). Spacing đều nhau, căn giữa canvas.
>
> ENTRANCE: Row 1 slide in từ trái tại 0.3s. Dấu ✓ appear 0.4s sau khi row visible. Row 2 tại 1.5s. Row 3 tại 2.8s. Mỗi row có SFX click khi xuất hiện.
>
> FOCAL MOMENT: Tại 3.5s (khi row 3 và ✓ cuối visible): toàn bộ checklist có brief green flash — "done" feeling.
>
> VIEWER EMOTION: "Chỉ 3 bước — mình làm được trong buổi sáng."
>
> VO SYNC: VO nói "bước một" → row 1 xuất hiện. "Bước hai" → row 2. "Bước ba" → row 3.

---

## Motion Vocabulary

Dùng trong visual_brief — agent HyperFrames nhận diện và implement đúng:

| Từ | Ý nghĩa animation |
|---|---|
| `slam` | Xuất hiện mạnh từ ngoài frame, expo.out, instant |
| `bloom` | Scale từ 0 → 1 tại center, radial expand |
| `drift` | Float nhẹ y ±20–40px, power2.inOut chậm |
| `snap` | back.out(2) có bounce nhẹ, nhanh |
| `cascade` | Elements lần lượt với stagger đều |
| `draw-on` | SVG line hoặc path vẽ từ từ theo hướng |
| `sweep` | Quét ngang từ trái → phải (divider, underline) |
| `pulse` | Sine.inOut lặp lại — scale hoặc glow ambient |
| `burst` | Glow hoặc scale spike mạnh rồi fade về — focal moment |
| `float` | Up-down ambient motion chậm, liên tục |
| `impact` | Xuất hiện + scale overshoot rồi settle — cho số lớn |
| `reveal` | Clip-path hoặc opacity từng phần, như đang mở màn |

---

## SFX Timing

Visual event phải xảy ra ĐÚNG khi SFX phát — không trước, không sau:

| SFX | Visual event tương ứng |
|---|---|
| `drum-hit` | Element đầu tiên slam/impact in |
| `whoosh` | Element sweep ngang hoặc transition |
| `ding` | Node kết nối xong, connection complete |
| `click` | Card/step pop in |
| `impact` | Số lớn xuất hiện |
| `chime` | CTA badge xuất hiện, scene kết thúc nhẹ nhàng |
| `whoosh-soft` | Transition mềm giữa các section |

---

## Clip Duration Rule (quan trọng)

**Mọi clip trong sub-composition phải có `data-duration` đủ để tồn tại đến cuối scene.**

`data-duration` của clip = `scene_duration - data-start`

Ví dụ: scene_duration = 8.0s, clip start = 1.5s → `data-duration = 6.5s`

Clip KHÔNG được biến mất trước khi scene kết thúc — trừ trường hợp có animation exit có chủ đích trong visual_brief.

---

## Output Format

Lưu vào `{project-path}/video-plan.json`:

```json
{
  "design": "DESIGN.md",
  "format": "9:16",
  "total_duration": 29.0,
  "scenes": [
    {
      "sceneId": "scene_01",
      "duration": 2.6,
      "content_shape": "big-number",
      "mood": "explosive",
      "transition": { "type": "flash-white", "duration": 0.3 },
      "sfx_picks": [
        { "id": "drum-hit", "at": 0.0, "volume": 0.6 }
      ],
      "elements": [
        { "id": "number",  "text": "3",           "role": "hero number — neon green 130px, dominates" },
        { "id": "unit",    "text": "GIỜ/NGÀY",    "role": "unit label — smaller, white" },
        { "id": "caption", "text": "để viết content?", "role": "context — muted, drift in" }
      ],
      "visual_brief": "CONTENT SHAPE: big-number...\nHERO FRAME: ...\nENTRANCE: ...\nFOCAL MOMENT: ...\nVIEWER EMOTION: ...\nVO SYNC: ...",
      "subtitle": true
    }
  ]
}
```

`duration` = `_audio.scene_duration` từ scenes-with-timing.json.

---

## Checklist

- [ ] Đã xác định `content_shape` trước khi viết visual?
- [ ] Shape phù hợp với cấu trúc ý tưởng trong narration?
- [ ] `visual_brief` có đủ 5 phần + content_shape?
- [ ] Elements list reflect đúng shape (node/line cho flow, column cho comparison...)?
- [ ] Focal moment có timestamp cụ thể và sync với SFX?
- [ ] Viewer emotion KHÔNG phải "ấn tượng" hay "đẹp"?
- [ ] `duration` = `_audio.scene_duration`?
- [ ] Không có 2 scene liên tiếp cùng content_shape?
