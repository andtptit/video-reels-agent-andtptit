import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useJobStatus } from "../useJobStatus.js";
import { LiveLog } from "./LiveLog.jsx";
import { ModelSelect } from "./ModelSelect.jsx";
import { EXPENSIVE_MODELS } from "../lib/pipelineOptions.js";

/**
 * "Tạo từ audio có sẵn" tab — upload 1 file audio đã thu sẵn (tự thu, thuê ngoài,
 * podcast...) thay vì gõ ý tưởng: server tự phiên âm (transcribe), cắt cảnh theo ý
 * nghĩa, rồi cắt audio gốc theo từng cảnh — thay thế bước "1. Content plan" + "2.
 * Audio" trong 1 lượt. Từ "3. Video plan" trở đi dùng lại đúng Pipeline.jsx, không
 * đổi gì (xem plan.md).
 *
 * Đứng riêng như 1 tab (không phải card trong Pipeline.jsx) vì đây là 1 điểm khởi đầu
 * MỚI hoàn toàn (giống ProjectForm/Batch/Hook — "có 1 input, tạo project mới"), không
 * phải biến thể của 1 project đã có (khác Remix).
 */
const WHISPER_MODELS = [
  ["small", "Small — nhanh, đủ tốt cho giọng nói rõ, không nhạc nền"],
  ["medium", "Medium — chậm hơn, chính xác hơn (audio hơi ồn/có nhạc nền nhẹ)"],
  ["large-v3", "Large-v3 — chậm nhất, chính xác nhất"],
];

const LANGUAGES = [
  ["vi", "Tiếng Việt"],
  ["en", "Tiếng Anh"],
];

export function AudioImport({ onProjectCreated }) {
  const [title, setTitle] = useState("");
  const [orientation, setOrientation] = useState("portrait");
  const [file, setFile] = useState(null);
  const [language, setLanguage] = useState("vi");
  const [whisperModel, setWhisperModel] = useState("small");
  const [model, setModel] = useState("");

  const [projectId, setProjectId] = useState(null);
  const [platform, setPlatform] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const { steps, events } = useJobStatus(projectId);
  const importStatus = steps["audio-import"]?.status;

  useEffect(() => {
    if (!projectId) return;
    if (importStatus === "done") onProjectCreated(projectId, title, platform);
    if (importStatus === "error") setError(steps["audio-import"]?.error || "Tạo từ audio thất bại.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importStatus]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { id, platform: plat } = await api.createProject(title, orientation);
      setPlatform(plat);
      await api.runAudioImport(id, file, { language, whisperModel, model: model || undefined, platform: plat });
      setProjectId(id); // after upload accepted — starts useJobStatus's SSE subscription
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  const running = submitting && importStatus !== "error";

  return (
    <form onSubmit={submit} className="card">
      <h2>Tạo project từ audio có sẵn</h2>
      <p className="muted">
        Upload 1 file audio đã có sẵn (tự thu, thuê ngoài, podcast...) — hệ thống tự
        phiên âm, cắt cảnh theo ý nghĩa, và cắt audio gốc theo từng cảnh. Từ bước
        "Video plan" trở đi giống hệt luồng bình thường.
      </p>

      <input
        placeholder="Tên project (dùng để đặt tên thư mục, vd: Podcast tuần 32)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        disabled={running}
      />

      <div className="inline-form">
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          required
          disabled={running}
        />
      </div>

      <div className="inline-form">
        <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={running} title="Ngôn ngữ audio — bắt buộc để phiên âm đúng (model tiếng Anh sẽ DỊCH thay vì phiên âm audio không phải tiếng Anh)">
          {LANGUAGES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select value={whisperModel} onChange={(e) => setWhisperModel(e.target.value)} disabled={running} title="Whisper model — model lớn hơn chính xác hơn nhưng chậm hơn">
          {WHISPER_MODELS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <ModelSelect value={model} onChange={setModel} options={EXPENSIVE_MODELS} title="Model cắt cảnh theo ý nghĩa" />
      </div>

      <fieldset className="orientation-picker">
        <legend>Định dạng video</legend>
        <label>
          <input type="radio" name="orientation" value="portrait" checked={orientation === "portrait"} onChange={() => setOrientation("portrait")} disabled={running} />
          Dọc (9:16 — TikTok/Reels/Shorts)
        </label>
        <label>
          <input type="radio" name="orientation" value="landscape" checked={orientation === "landscape"} onChange={() => setOrientation("landscape")} disabled={running} />
          Ngang (16:9 — YouTube)
        </label>
      </fieldset>

      <button type="submit" disabled={running || !file || !title.trim()}>
        {running ? "Đang xử lý..." : "Tạo project từ audio"}
      </button>
      {error && <p className="error">{error}</p>}
      {running && (
        <>
          <p className="muted">
            {importStatus === "running" ? "Đang phiên âm + cắt cảnh — có thể mất vài phút tuỳ độ dài audio và whisper model." : "Đang tải audio lên..."}
          </p>
          <LiveLog events={events} step="audio-import" maxLines={10} />
        </>
      )}
    </form>
  );
}
