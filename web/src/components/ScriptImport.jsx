import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useJobStatus } from "../useJobStatus.js";
import { LiveLog } from "./LiveLog.jsx";

/**
 * "Dán kịch bản có sẵn" tab — user pastes their OWN already-written script (not an
 * idea for AI to expand). Scene-cutting is 100% code, no LLM at all — see
 * script-scene-cutter.mjs's own doc comment on why (found live: even a strong hint
 * still let a model cut in the wrong place sometimes). A line containing only "==="
 * is the explicit scene-cut marker; a script with none falls back to splitting on
 * blank lines.
 *
 * Deliberately NOT auto-run into the rest of the pipeline (unlike AudioImport.jsx) —
 * still worth eyeballing scenes.json before spending on TTS/video-plan (e.g. to catch
 * a missed "===" merging two beats together), same reasoning as Investigation.jsx's
 * "ai" mode keeping the normal pause-after-plan checkpoint.
 */
export function ScriptImport({ profiles, onProjectCreated }) {
  const [title, setTitle] = useState("");
  const [orientation, setOrientation] = useState("portrait");
  const [scriptText, setScriptText] = useState("");
  const [profileSlug, setProfileSlug] = useState("");

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
      await api.runScriptPlan(id, { scriptText, platform: plat, profileSlug: profileSlug || undefined });
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
        Dán nguyên văn kịch bản bạn đã tự viết — <strong>không AI viết lại, không
        paraphrase</strong> bất kỳ chữ nào, cắt cảnh 100% bằng code theo đúng dấu bạn
        đánh. Gõ 1 dòng chỉ có <code>===</code> ở chỗ muốn ngắt sang scene mới; kịch
        bản không có dấu nào thì tự cắt theo dòng trống giữa các đoạn. Sau khi cắt
        xong, xem lại <code>scenes.json</code> trước khi chạy tiếp bước đọc giọng
        (TTS) để chắc không sót chỗ nào cần đánh dấu.
      </p>

      <input
        placeholder='Tên project (dùng để đặt tên thư mục, vd: "Ba câu thần chú")'
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        disabled={running}
      />

      <textarea
        placeholder={"Dán nguyên văn kịch bản vào đây...\n\n===\n\n(đặt \"===\" trên 1 dòng riêng ở chỗ muốn ngắt scene)"}
        value={scriptText}
        onChange={(e) => setScriptText(e.target.value)}
        rows={14}
        required
        disabled={running}
      />
      <p className="muted">{wordCount} từ (~{Math.max(1, Math.round(wordCount / 2.5))}s đọc, ước tính)</p>

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
