const LABEL = { running: "Đang chạy…", done: "Xong", error: "Lỗi", idle: "Chưa chạy", cancelled: "Đã huỷ" };
const COLOR = { running: "#d68a10", done: "#1a8f4c", error: "#c62828", idle: "#888", cancelled: "#666" };

export function StatusBadge({ status }) {
  const s = status ?? "idle";
  return (
    <span style={{ color: COLOR[s] ?? "#888", fontWeight: 600, fontSize: "0.85em" }}>
      {LABEL[s] ?? s}
    </span>
  );
}
