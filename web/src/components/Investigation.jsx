import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useJobStatus } from "../useJobStatus.js";
import { LiveLog } from "./LiveLog.jsx";
import { ModelSelect } from "./ModelSelect.jsx";
import { EXPENSIVE_MODELS } from "../lib/pipelineOptions.js";

/**
 * "Bảng điều tra" tab — nhập 1 chủ đề/vụ việc điều tra thay vì ý tưởng thường: server
 * viết kịch bản theo mạch điều tra (bí ẩn → dòng thời gian → bằng chứng → hệ luỵ, xem
 * .agents/skills/investigation-content-planner/SKILL.md) thay cho mạch bán hàng của
 * content-planner thông thường — đúng shape master_content.md/scenes.json nên "2.
 * Audio" trở đi dùng lại HOÀN TOÀN Pipeline.jsx không đổi gì.
 *
 * Đứng riêng như 1 tab (không phải card trong Pipeline.jsx) — cùng lý do AudioImport:
 * đây là điểm khởi đầu MỚI (tạo project mới), không phải biến thể của project có sẵn.
 * Khác Hook.jsx (không hand-off, tự chạy hết chuỗi riêng) vì style này CÓ giọng đọc,
 * cần tái dùng nguyên generate-audio.mjs/root-composer — xem plan.md.
 *
 * Style ảnh (nền giấy cũ + ảnh Pexels viền xé giấy) là 1 subStyle mới trong template
 * "sub" sẵn có (không phải template riêng) — chọn qua channel profile như bình thường,
 * KHÔNG có UI riêng ở đây; chọn 1 profile đã cấu hình sẵn subStyle này để tự áp khi
 * vào Pipeline.jsx.
 */
export function Investigation({ profiles, onProjectCreated }) {
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [audience, setAudience] = useState("");
  const [orientation, setOrientation] = useState("portrait");
  const [profileSlug, setProfileSlug] = useState("");
  const [model, setModel] = useState("");

  const [projectId, setProjectId] = useState(null);
  const [platform, setPlatform] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const { steps, events } = useJobStatus(projectId);
  const planStatus = steps["investigation-plan"]?.status;

  useEffect(() => {
    if (!projectId) return;
    if (planStatus === "done") onProjectCreated(projectId, idea, platform, profileSlug || undefined);
    if (planStatus === "error") setError(steps["investigation-plan"]?.error || "Viết kịch bản điều tra thất bại.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planStatus]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { id, platform: plat } = await api.createProject(title, orientation);
      setPlatform(plat);
      await api.runInvestigationPlan(id, { idea, audience, platform: plat, model: model || undefined });
      setProjectId(id); // after accepted — starts useJobStatus's SSE subscription
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  const running = submitting && planStatus !== "error";

  return (
    <form onSubmit={submit} className="card">
      <h2>Tạo video "Bảng điều tra"</h2>
      <p className="muted">
        Nhập chủ đề/vụ việc điều tra — hệ thống viết kịch bản theo mạch điều tra (dòng
        thời gian, bằng chứng, hệ luỵ), khác mạch bán hàng thông thường. Chọn 1 channel
        profile đã cấu hình sẵn template "Sub karaoke" + style "Bảng điều tra" bên dưới
        để tự áp đúng style khi vào Pipeline — chưa có thì tạo qua "+ Quản lý profile
        kênh" trước.
      </p>

      <input
        placeholder='Tên project (dùng để đặt tên thư mục, vd: "Panama Papers")'
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        disabled={running}
      />

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
        <ModelSelect value={model} onChange={setModel} options={EXPENSIVE_MODELS} title="Model viết kịch bản điều tra" />
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

      <button type="submit" disabled={running || !idea.trim() || !audience.trim() || !title.trim()}>
        {running ? "Đang viết kịch bản..." : "Tạo project điều tra"}
      </button>
      {error && <p className="error">{error}</p>}
      {running && <LiveLog events={events} step="investigation-plan" maxLines={10} />}
    </form>
  );
}
