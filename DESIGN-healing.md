## Style Prompt
Minh hoạ doodle tay vẽ, ấm áp và gần gũi — cảm giác như trang "confession"/tâm sự
trên mạng xã hội Việt Nam. Nhân vật nét đơn giản (stick-figure có thân, không chi
tiết mặt phức tạp), nét vẽ đen mảnh, không tô bóng cầu kỳ. Nền màu đất ấm, tĩnh lặng,
không rực rỡ — tông "hoài niệm buổi chiều" chứ không phải vui tươi sặc sỡ.

## Colors
- `#C9A98A` — nền chính, be/nâu đất ấm (gradient nhạt hơn ở trên, tối dần xuống dưới còn `#8B6F52`)
- `#7B3B32` — nâu đỏ trầm, dùng cho trang phục nhân vật chính / điểm nhấn hình minh hoạ
- `#5D7A93` — xanh xám khói, nhân vật phụ / chi tiết đối lập nhẹ
- `#FFFFFF` — chữ caption chính
- `#E8974D` — cam ấm, highlight từ khoá trong caption (karaoke/nhấn từ)
- `#2A2018` — nét vẽ đen mảnh (outline nhân vật, doodle icon)

## Typography
Toàn bộ font dưới đây đã xác nhận THẬT (không đoán) qua Google Fonts metadata API
(`fonts.google.com/metadata/fonts/<tên>`, kiểm tra field `coverage.vietnamese` có tồn
tại hay không — nhiều font viết tay phổ biến như Caveat, Kalam, Patrick Hand, Permanent
Marker, Indie Flower, Dekko... đã thử và KHÔNG có subset tiếng Việt, bị loại):

- `Itim` — **mặc định**, chữ viết tay bo tròn, gần giống ảnh mẫu người dùng gửi nhất.
  Subset `vietnamese` đầy đủ dấu (258-259, 272-273, 296-297, 360-361, 416-417, 431-432,
  768-769, 771-772, 776-777, 803, 7840-7929)
- `Mali` — viết tay, nhiều độ đậm hơn Itim (200–700, cả italic), dùng khi cần phân cấp
  chữ (caption phụ nhỏ hơn)
- `Pacifico` — script mềm mại, nét nối liền — hợp video tình cảm/lãng mạn hơn là
  "confession" thô mộc
- `Charm` — thư pháp thanh mảnh, trang trọng nhẹ nhàng
- `Sriracha` — bút lông/marker, nét khoẻ hơn — hợp nội dung mạnh mẽ, quyết đoán
- `Amatic SC` — marker cô đặc, chữ hẹp — hợp caption ngắn, nhấn mạnh từng chữ
- Đây là danh sách trong dropdown UI (`fontFamily` param) — chọn 1 trong 6, không cần
  sửa file này để đổi font cho 1 video cụ thể
- Không dùng font hình học/sans-serif hiện đại (Inter, Exo 2, Be Vietnam Pro dù font
  này CÓ hỗ trợ tiếng Việt — chỉ là không phải kiểu viết tay) — phá vỡ cảm giác gần
  gũi mà DESIGN này hướng tới

## Motion Defaults
- Entrances: chậm, nhẹ nhàng — fade + drift nhẹ (power2.out), KHÔNG dùng back.out/bounce
  (quá "vui tươi", lệch tông trầm lắng)
- Karaoke highlight từ: đổi màu từ trắng sang `#E8974D` đúng lúc từ được nói, chuyển
  màu mượt (power1.inOut), không có hiệu ứng scale/pop giật
- Ambient: gần như tĩnh — nếu có chuyển động nền, chỉ là drift cực chậm (vd mây trôi),
  không pulse/glow như phong cách tech

## Atmosphere
- Ảnh nền AI full-frame (phong cách doodle/line-art tay vẽ, xem "Style Prompt") —
  không dùng dot-grid/scanline/corner-bracket kiểu tech
- Gradient tối nhẹ ở đáy khung hình (dưới caption) để chữ trắng luôn đọc được dù ảnh
  nền sáng
- Không có khung viền, không có atmosphere overlay nào khác ngoài chính ảnh nền

## What NOT to Do
- Không dùng neon, glow rực, hoặc màu bão hoà cao — mọi màu phải "ấm và trầm", không
  quá tươi dù yêu cầu ban đầu là "tươi sáng hơn" bản gốc (tươi sáng ở đây nghĩa là
  ấm/dễ chịu hơn dark-tech, KHÔNG phải rực rỡ/neon)
- Không dùng easing "explosive"/"back.out" — mọi chuyển động phải chậm, mượt
- Không thêm chi tiết phức tạp vào nhân vật minh hoạ (giữ tối giản như ảnh mẫu)
- Không dùng font sans-serif hình học cho caption chính
