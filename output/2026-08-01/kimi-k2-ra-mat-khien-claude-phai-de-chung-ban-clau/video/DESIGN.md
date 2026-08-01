## Style Prompt
Dark tech aesthetic với neon green accent. Cảm giác như terminal/matrix nhưng clean và modern. Không phải cyberpunk lòe loẹt — mà là precision tech, giống dashboard của một startup AI thực sự.

## Colors
- `#39FF14` — neon green, primary accent (glow, highlights, active elements)
- `#060810` — near-black background
- `#FFFFFF` — pure white cho headline text
- `rgba(255,255,255,0.55)` — secondary text, labels
- `rgba(57,255,20,0.12)` — card fill / subtle surface

## Typography
- `Exo 2` — headlines, badges, bold display text (weight 700–900)
- `Inter` — body, labels, tags (weight 400–600)
- `Playfair Display Italic` — for keyword

## Motion Defaults
- Entrances: fast và sharp (expo.out, back.out) — không dùng linear
- Ambient: slow sine pulse cho glow elements
- Mood keywords → easing map:
  - "explosive" → scale pop + expo.out, stagger nhanh
  - "cinematic" → slow fade + slight y drift
  - "snappy" → back.out(2) với stagger 0.08s
  - "fluid" → power2.inOut, elements flow liên tiếp
  - "technical" → elements xuất hiện theo thứ tự logic (top→down, left→right)

## Atmosphere
- Dot grid background (48px grid, 1.5px dot, opacity 0.28) luôn có
- Radial glow ở center/focus point của cảnh
- Corner brackets ở 4 góc (56px, border 3px, opacity 0.5)
- Scanlines overlay nhẹ (opacity 0.04)
- Particles nhỏ nổi lên (optional, dùng khi cần thêm depth)

## What NOT to Do
- Không dùng màu xanh dương hay tím — palette này là green-only
- Không dùng drop shadow nặng trên text — dùng text-shadow glow thay thế
- Không dùng border-radius > 20px trên card
- Không dùng font light (weight < 500) cho text quan trọng
- Không để background hoàn toàn trống — luôn có dot grid + radial glow
