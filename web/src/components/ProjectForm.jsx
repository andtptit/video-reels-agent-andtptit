import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useBatchStatus } from "../useJobStatus.js";

export function ProjectForm({ onCreated, profiles = [] }) {
  const [profileSlug, setProfileSlug] = useState("");
  const [audience, setAudience] = useState("");

  const [idea, setIdea] = useState("");
  const [orientation, setOrientation] = useState("portrait");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // "LLM tự sinh chủ đề" — reuses the exact /batches route + idea-generator.mjs's
  // rotation/avoid-list diversity mechanism Batch.jsx already drives, just with
  // count:1: 1 suggestion to fill the textarea with (still editable, not auto-
  // submitted) instead of a whole batch to review/keep/discard. No new backend route.
  const [suggestBatchId, setSuggestBatchId] = useState(null);
  const [suggestError, setSuggestError] = useState(null);
  const { steps: suggestSteps } = useBatchStatus(suggestBatchId);
  const suggesting = suggestSteps.ideate?.status === "running";

  useEffect(() => {
    if (suggestSteps.ideate?.status === "done" && suggestBatchId) {
      api
        .getBatch(suggestBatchId)
        .then((r) => {
          const suggested = r.ideas?.ideas?.[0]?.idea;
          if (suggested) setIdea(suggested);
          else setSuggestError("Không sinh được ý tưởng — thử lại.");
        })
        .catch((err) => setSuggestError(err.message))
        .finally(() => setSuggestBatchId(null)); // one-shot suggestion, not something to keep restoring
    }
    if (suggestSteps.ideate?.status === "error") {
      setSuggestError(suggestSteps.ideate.error);
      setSuggestBatchId(null);
    }
  }, [suggestSteps.ideate?.status, suggestBatchId]);

  function onSelectProfile(slug) {
    setProfileSlug(slug);
    const p = profiles.find((x) => x.slug === slug);
    if (p?.defaultAudience !== undefined) setAudience(p.defaultAudience);
  }

  async function suggestIdea() {
    setSuggestError(null);
    const profile = profiles.find((p) => p.slug === profileSlug);
    if (!profile?.channelTheme?.trim()) {
      setSuggestError("Profile này chưa có chủ đề kênh (channelTheme) — điền ở tab Hàng loạt trước, hoặc tự gõ ý tưởng.");
      return;
    }
    if (!audience.trim()) {
      setSuggestError("Nhập đối tượng xem trước đã.");
      return;
    }
    try {
      const { batchId } = await api.startBatch({ channelTheme: profile.channelTheme, audience, count: 1, profileSlug });
      setSuggestBatchId(batchId);
    } catch (err) {
      setSuggestError(err.message);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { id, platform } = await api.createProject(idea, orientation);
      onCreated(id, idea, platform, profileSlug || undefined);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <h2>Ý tưởng video mới</h2>

      <div className="inline-form">
        <select value={profileSlug} onChange={(e) => onSelectProfile(e.target.value)} title="Chọn channel profile (tuỳ chọn) — dùng để LLM gợi ý chủ đề đúng hướng, và tự áp cấu hình profile ở bước sau">
          <option value="">— Chọn channel profile (tuỳ chọn) —</option>
          {profiles.map((p) => (
            <option key={p.slug} value={p.slug}>{p.name}</option>
          ))}
        </select>
        {profileSlug && (
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="Đối tượng xem — vd: Nữ 20-30 tuổi, hay lo âu"
            style={{ minWidth: "220px" }}
          />
        )}
      </div>

      <div className="inline-form">
        <button type="button" disabled={!profileSlug || suggesting} onClick={suggestIdea}>
          {suggesting ? "Đang sinh chủ đề…" : "LLM tự sinh chủ đề"}
        </button>
        <span className="muted">hoặc tự gõ thẳng bên dưới</span>
      </div>
      {suggestError && <p className="error">{suggestError}</p>}

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
