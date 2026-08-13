import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useJobStatus } from "../useJobStatus.js";
import { LiveLog } from "./LiveLog.jsx";
import { ModelSelect } from "./ModelSelect.jsx";
import { EXPENSIVE_MODELS } from "../lib/pipelineOptions.js";

/**
 * "Dán kịch bản có sẵn" tab — user pastes their OWN already-written script (not an
 * idea for AI to expand). The AI's only job is cutting it into scenes by meaning —
 * see script-scene-cutter.mjs's own doc comment on why narration text is always
 * reconstructed in code from the model's chosen word boundaries, never retyped by
 * the model itself, so a carefully-written line can never come back paraphrased.
 *
 * Deliberately NOT auto-run into the rest of the pipeline (unlike AudioImport.jsx) —
 * the model still made a creative choice here (WHERE to cut), worth eyeballing in
 * scenes.json before spending on TTS/video-plan, same reasoning as Investigation.jsx's
 * "ai" mode keeping the normal pause-after-plan checkpoint.
 */
export function ScriptImport({ profiles, onProjectCreated }) {
  const [title, setTitle] = useState("");
  const [orientation, setOrientation] = useState("portrait");
  const [scriptText, setScriptText] = useState("");
  const [targetDuration, setTargetDuration] = useState("30–60s");
  const [profileSlug, setProfileSlug] = useState("");
  const [model, setModel] = useState("");

  const [projectId, setProjectId] = useState(null);
  const [platform, setPlatform] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const { steps, events } = useJobStatus(projectId);
  const planStatus = steps["script-plan"]?.status;

  useEffect(() => {
    if (!projectId) return;
    if (planStatus === "done") onProjectCreated(projectId, title, platform, profileSlug || undefined);
    if (planStatus === "error") setError(steps["script-plan"]?.error || "Cắt cảnh kịch bản thất bại.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planStatus]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { id, platform: plat } = await api.createProject(title, orientation);
      setPlatform(plat);
      await api.runScriptPlan(id, { scriptText, targetDuration, platform: plat, model: model || undefined, profileSlug: profileSlug || undefined });
      setProjectId(id); // after accepted — starts useJobStatus's SSE subscription
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  const running = submitting && planStatus !== "error";
  const wordCount = scriptText.trim() ? scriptText.trim().split(/\s+/).length : 0;

  return (
    <form onSubmit={submit} className="card">
      <h2>Dán kịch bản có sẵn</h2>
      <p className="muted">
        Dán nguyên văn kịch bản bạn đã tự viết — AI <strong>không viết lại, không
        paraphrase</strong> bất kỳ chữ nào, chỉ chọn ranh giới cắt cảnh theo ý nghĩa.
        Để dòng trống giữa các đoạn để gợi ý điểm cắt tự nhiên (giống 1 nhịp/1 beat
        riêng). Sau khi cắt xong, bạn nên xem lại <code>scenes.json</code> trước khi
        chạy tiếp bước đọc giọng (TTS) — vì đây là chỗ duy nhất AI "quyết định" thay
        bạn (chọn điểm cắt), phần chữ thì luôn giữ nguyên 100%.
      </p>

      <input
        placeholder='Tên project (dùng để đặt tên thư mục, vd: "Ba câu thần chú")'
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        disabled={running}
      />

      <textarea
        placeholder="Dán nguyên văn kịch bản vào đây — để dòng trống giữa các đoạn/nhịp..."
        value={scriptText}
        onChange={(e) => setScriptText(e.target.value)}
        rows={14}
        required
        disabled={running}
      />
      <p className="muted">{wordCount} từ (~{Math.max(1, Math.round(wordCount / 2.5))}s đọc, ước tính)</p>

      <div className="inline-form">
        <select value={targetDuration} onChange={(e) => setTargetDuration(e.target.value)} disabled={running} title="Chỉ để tham khảo — AI ưu tiên cắt đúng ranh giới ý nghĩa hơn khớp đúng con số này">
          <option value="20–30s">Ngắn (20-30s)</option>
          <option value="30–60s">Vừa (30-60s)</option>
          <option value="60–90s">Dài (60-90s)</option>
          <option value="2–3 phút">Rất dài (2-3 phút)</option>
        </select>
        <ModelSelect value={model} onChange={setModel} options={EXPENSIVE_MODELS} title="Model cắt cảnh" />
      </div>

      <div className="inline-form">
        <select
          value={profileSlug}
          onChange={(e) => setProfileSlug(e.target.value)}
          disabled={running}
          title="Chọn profile đã cấu hình sẵn template/style/giọng đọc, để tự áp khi vào Pipeline"
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

      <button type="submit" disabled={running || !scriptText.trim() || !title.trim()}>
        {running ? "Đang cắt cảnh..." : "Cắt cảnh kịch bản"}
      </button>
      {error && <p className="error">{error}</p>}
      {running && <LiveLog events={events} step="script-plan" maxLines={10} />}
    </form>
  );
}
