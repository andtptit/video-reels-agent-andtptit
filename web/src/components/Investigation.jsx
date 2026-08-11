import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useJobStatus } from "../useJobStatus.js";
import { LiveLog } from "./LiveLog.jsx";
import { ModelSelect } from "./ModelSelect.jsx";
import { EXPENSIVE_MODELS } from "../lib/pipelineOptions.js";

/**
 * "Bảng điều tra" tab — 2 cách vào: (1) nhập chủ đề, AI viết kịch bản theo mạch điều
 * tra (bí ẩn → dòng thời gian → bằng chứng → hệ luỵ, xem .agents/skills/
 * investigation-content-planner/SKILL.md) + TTS; (2) upload 1 file audio đã có sẵn
 * (tự thu, thuê giọng ngoài...) — tái dùng NGUYÊN route `/audio-import` đã xây cho tab
 * "Từ audio có sẵn" (transcribe + tự cắt cảnh không quan tâm nội dung là gì, nên dùng
 * được cho bất kỳ mạch nội dung nào, kể cả điều tra) thay vì viết lại logic riêng.
 * Cả 2 nhánh đều ra đúng shape master_content.md/scenes.json nên "2. Audio" (nhánh AI)
 * hoặc thẳng "3. Video plan" (nhánh upload — audio đã có sẵn) trở đi dùng lại HOÀN
 * TOÀN Pipeline.jsx không đổi gì.
 *
 * Đứng riêng như 1 tab (không phải card trong Pipeline.jsx) — cùng lý do AudioImport:
 * đây là điểm khởi đầu MỚI (tạo project mới), không phải biến thể của project có sẵn.
 *
 * Style ảnh (nền giấy cũ + ảnh thật viền xé giấy) là 1 subStyle mới trong template
 * "sub" sẵn có (không phải template riêng) — chọn qua channel profile như bình thường,
 * KHÔNG có UI riêng ở đây; chọn 1 profile đã cấu hình sẵn subStyle này để tự áp khi
 * vào Pipeline.jsx.
 */
const DURATION_OPTIONS = [
  ["20–30s", "Ngắn (20-30s)"],
  ["30–60s", "Vừa (30-60s)"],
  ["60–90s", "Dài (60-90s)"],
  ["2–3 phút", "Rất dài (2-3 phút)"],
  ["3–5 phút", "Phim tài liệu ngắn (3-5 phút)"],
];

const WHISPER_MODELS = [
  ["small", "Small — nhanh, đủ tốt cho giọng nói rõ, không nhạc nền"],
  ["medium", "Medium — chậm hơn, chính xác hơn (audio hơi ồn/có nhạc nền nhẹ)"],
  ["large-v3", "Large-v3 — chậm nhất, chính xác nhất"],
];

const LANGUAGES = [
  ["vi", "Tiếng Việt"],
  ["en", "Tiếng Anh"],
];

export function Investigation({ profiles, onProjectCreated }) {
  const [mode, setMode] = useState("ai"); // "ai" | "upload"
  const [title, setTitle] = useState("");
  const [orientation, setOrientation] = useState("portrait");
  const [profileSlug, setProfileSlug] = useState("");

  // Nhánh "ai"
  const [idea, setIdea] = useState("");
  const [audience, setAudience] = useState("");
  const [targetDuration, setTargetDuration] = useState("30–60s");
  const [model, setModel] = useState("");

  // Nhánh "upload"
  const [file, setFile] = useState(null);
  const [language, setLanguage] = useState("vi");
  const [whisperModel, setWhisperModel] = useState("small");

  const [projectId, setProjectId] = useState(null);
  const [platform, setPlatform] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const stepKey = mode === "upload" ? "audio-import" : "investigation-plan";
  const { steps, events } = useJobStatus(projectId);
  const planStatus = steps[stepKey]?.status;

  useEffect(() => {
    if (!projectId) return;
    if (planStatus === "done") onProjectCreated(projectId, idea || title, platform, profileSlug || undefined);
    if (planStatus === "error") setError(steps[stepKey]?.error || "Tạo project thất bại.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planStatus]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { id, platform: plat } = await api.createProject(mode === "upload" ? title : idea, orientation);
      setPlatform(plat);
      if (mode === "upload") {
        await api.runAudioImport(id, file, { language, whisperModel, model: model || undefined, platform: plat });
      } else {
        await api.runInvestigationPlan(id, { idea, audience, platform: plat, targetDuration, model: model || undefined });
      }
      setProjectId(id); // after accepted — starts useJobStatus's SSE subscription
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  const running = submitting && planStatus !== "error";
  const canSubmit = mode === "upload" ? Boolean(file) && title.trim() : idea.trim() && audience.trim() && title.trim();

  return (
    <form onSubmit={submit} className="card">
      <h2>Tạo video "Bảng điều tra"</h2>
      <p className="muted">
        Chọn 1 channel profile đã cấu hình sẵn template "Sub karaoke" + style "Bảng
        điều tra" bên dưới để tự áp đúng style khi vào Pipeline — chưa có thì tạo qua
        "+ Quản lý profile kênh" trước.
      </p>

      <div className="inline-form">
        <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
          <input type="radio" name="mode" checked={mode === "ai"} onChange={() => setMode("ai")} disabled={running} style={{ width: "auto", marginBottom: 0 }} />
          AI viết kịch bản + đọc giọng TTS
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
          <input type="radio" name="mode" checked={mode === "upload"} onChange={() => setMode("upload")} disabled={running} style={{ width: "auto", marginBottom: 0 }} />
          Tôi đã có sẵn giọng đọc (upload audio)
        </label>
      </div>

      <input
        placeholder='Tên project (dùng để đặt tên thư mục, vd: "Panama Papers")'
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        disabled={running}
      />

      {mode === "ai" ? (
        <>
          <textarea
            placeholder="Chủ đề/vụ việc điều tra — càng chi tiết càng tốt (vd: vụ rò rỉ hồ sơ Panama Papers 2016, công ty luật Mossack Fonseca...)"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={3}
            required
            disabled={running}
          />
          <div className="inline-form">
            <input
              placeholder="Đối tượng xem — vd: người quan tâm thời sự/tài chính"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              required
              disabled={running}
              style={{ minWidth: "260px" }}
            />
            <select value={targetDuration} onChange={(e) => setTargetDuration(e.target.value)} disabled={running} title="Thể loại điều tra thường hợp với video dài hơn short-form thông thường">
              {DURATION_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <ModelSelect value={model} onChange={setModel} options={EXPENSIVE_MODELS} title="Model viết kịch bản điều tra" />
          </div>
          {(targetDuration === "2–3 phút" || targetDuration === "3–5 phút") && (
            <p className="muted">
              Lưu ý: video dài hơn cần nhiều scene hơn (mỗi scene vẫn 5-10s như thường) —
              tốn thêm thời gian + phí TTS/sinh ảnh cho từng scene, không chỉ 1 lượt viết
              kịch bản dài hơn.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="muted">
            Giọng đọc là thứ hấp dẫn nhất của style này sau hình ảnh — dùng bản ghi âm
            thật hoặc giọng TTS cao cấp hơn từ nơi khác, hệ thống tự phiên âm + cắt cảnh
            theo đúng nội dung đã nói, không cần AI viết kịch bản.
          </p>
          <div className="inline-form">
            <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required disabled={running} />
          </div>
          <div className="inline-form">
            <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={running} title="Ngôn ngữ audio — bắt buộc để phiên âm đúng">
              {LANGUAGES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select value={whisperModel} onChange={(e) => setWhisperModel(e.target.value)} disabled={running} title="Whisper model — model lớn hơn chính xác hơn nhưng chậm hơn">
              {WHISPER_MODELS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="inline-form">
        <select
          value={profileSlug}
          onChange={(e) => setProfileSlug(e.target.value)}
          disabled={running}
          title="Chọn profile đã cấu hình template Sub + style Bảng điều tra, để tự áp khi vào Pipeline"
        >
          <option value="">— Chọn channel profile (khuyến nghị) —</option>
          {profiles.map((p) => (
            <option key={p.slug} value={p.slug}>{p.name}</option>
          ))}
        </select>
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

      <button type="submit" disabled={running || !canSubmit}>
        {running ? (mode === "upload" ? "Đang xử lý audio..." : "Đang viết kịch bản...") : "Tạo project điều tra"}
      </button>
      {error && <p className="error">{error}</p>}
      {running && <LiveLog events={events} step={stepKey} maxLines={10} />}
    </form>
  );
}
