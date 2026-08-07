// Shared dropdown option lists for anything that edits a channel profile's config —
// extracted out of Pipeline.jsx (which used to define these inline) so
// ProfileManager.jsx can offer the exact same choices without a second, driftable
// copy of each list.

// Chỉ liệt kê model đã xác nhận hoạt động thật (gọi thử tool_calls/image-gen thật) —
// đã loại: qwen-vl-ocr (cần ảnh đầu vào, không phải model chat), qwen-mt-flash
// (không hỗ trợ tool_calls, chỉ dịch), wan2.1-kf2v-plus/wan2.7-i2v/wan2.6-t2v (model
// SINH VIDEO, không tương thích endpoint sinh ảnh tĩnh hiện tại — cần tích hợp riêng).
// vi-VN-HoaiMyNeural (nữ, mặc định cũ) + vi-VN-NamMinhNeural (nam) — cả 2 đều là
// giọng Azure Neural miễn phí qua edge-tts, giữ cả 2 để chọn thay vì thay hẳn giọng
// cũ (user muốn nghe thử giọng nam nhưng không muốn mất lựa chọn giọng nữ).
export const EDGE_TTS_VOICES = [
  ["vi-VN-HoaiMyNeural", "HoaiMy (nữ) — mặc định"],
  ["vi-VN-NamMinhNeural", "NamMinh (nam)"],
];

export const EXPENSIVE_MODELS = ["qwen3.5-plus", "qwen-plus-2025-04-28"];
export const CHEAP_MODELS = ["qwen3.6-flash", "qwen-flash", "deepseek-v4-flash", "qwen3-vl-flash"];
export const IMAGE_MODELS = ["wan2.6-image", "qwen-image", "qwen-image-2.0", "z-image-turbo"];

export const FONT_OPTIONS = [
  ["Itim", "Itim (viết tay, tròn)"],
  ["Mali", "Mali (viết tay, nhiều độ đậm)"],
  ["Pacifico", "Pacifico (script mềm mại)"],
  ["Charm", "Charm (thư pháp, thanh)"],
  ["Sriracha", "Sriracha (bút lông, khoẻ)"],
  ["Amatic SC", "Amatic SC (marker, cô đặc)"],
];
