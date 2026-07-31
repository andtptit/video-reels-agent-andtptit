import { useState } from "react";
import { api } from "../api.js";

export function ProjectForm({ onCreated }) {
  const [idea, setIdea] = useState("");
  const [orientation, setOrientation] = useState("portrait");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { id, platform } = await api.createProject(idea, orientation);
      onCreated(id, idea, platform);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <h2>Ý tưởng video mới</h2>
      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="Ví dụ: 5 mẹo dùng ChatGPT tiết kiệm 2 giờ mỗi ngày cho dân văn phòng"
        rows={3}
        required
      />
      <fieldset className="orientation-picker">
        <legend>Định dạng video</legend>
        <label>
          <input type="radio" name="orientation" value="portrait" checked={orientation === "portrait"} onChange={() => setOrientation("portrait")} />
          Dọc (9:16 — TikTok/Reels/Shorts)
        </label>
        <label>
          <input type="radio" name="orientation" value="landscape" checked={orientation === "landscape"} onChange={() => setOrientation("landscape")} />
          Ngang (16:9 — YouTube)
        </label>
      </fieldset>
      <button type="submit" disabled={busy || !idea.trim()}>
        {busy ? "Đang tạo…" : "Tạo project"}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
