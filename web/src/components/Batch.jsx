import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useBatchStatus } from "../useJobStatus.js";
import { LiveLog } from "./LiveLog.jsx";
import { IdeaCard } from "./IdeaCard.jsx";

/** Waits until `api.getProject(projectId).status.steps[stepKey]` is "done"/"error" —
 *  same polling shape as Pipeline.jsx's own `waitForStep`, just re-pointed at a new
 *  project id every call instead of one fixed project (see runApproval below). */
function waitForProjectStep(projectId, stepKey, { pollMs = 1000, timeoutMs = 180_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, reject) => {
    const check = async () => {
      let status;
      try {
        ({ status } = await api.getProject(projectId));
      } catch (err) {
        return reject(err);
      }
      const s = status.steps?.[stepKey];
      if (s?.status === "done") return resolvePromise(s);
      if (s?.status === "error") return reject(new Error(s.error || `Bước "${stepKey}" thất bại`));
      if (Date.now() > deadline) return reject(new Error(`Timeout chờ "${stepKey}" cho project ${projectId}`));
      setTimeout(check, pollMs);
    };
    check();
  });
}

/** createProject's slug is derived from the idea text and throws if the exact same
 *  slug dir already exists same-day (see new-project.mjs) — with several ideas
 *  generated on the same day, near-identical phrasing could collide. Cheap insurance:
 *  retry with a cosmetic suffix on the SLUG-DERIVING text only, never touching the
 *  real `ideaText` sent to content-planner afterward. */
async function createProjectWithRetry(ideaText, orientation, attempt = 0) {
  try {
    return await api.createProject(attempt === 0 ? ideaText : `${ideaText} (v${attempt + 1})`, orientation);
  } catch (err) {
    if (attempt < 3 && /đã tồn tại/i.test(err.message)) {
      return createProjectWithRetry(ideaText, orientation, attempt + 1);
    }
    throw err;
  }
}

export function Batch({ onProjectCreated }) {
  const [profiles, setProfiles] = useState([]);
  const [profileSlug, setProfileSlug] = useState("");
  const [channelTheme, setChannelTheme] = useState("");
  const [audience, setAudience] = useState("");
  const [count, setCount] = useState(10);
  const [orientation, setOrientation] = useState("portrait");

  const [batchId, setBatchId] = useState(null);
  const [ideasMeta, setIdeasMeta] = useState(null); // full ideas.json envelope
  const [approving, setApproving] = useState(false);
  const [formError, setFormError] = useState(null);

  const { steps, events } = useBatchStatus(batchId);
  const ideateStatus = steps.ideate?.status;

  // ensures the approval loop always reads the LATEST ideasMeta (state updates are
  // async; the loop below runs across many awaits, so a stale closure over
  // `ideasMeta` would silently work off the snapshot from when runApproval started).
  const ideasMetaRef = useRef(ideasMeta);
  useEffect(() => {
    ideasMetaRef.current = ideasMeta;
  }, [ideasMeta]);

  useEffect(() => {
    api.listProfiles().then((r) => setProfiles(r.profiles ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (ideateStatus === "done" && batchId) {
      api.getBatch(batchId).then((r) => setIdeasMeta(r.ideas)).catch((err) => setFormError(err.message));
    }
  }, [ideateStatus, batchId]);

  function onSelectProfile(slug) {
    setProfileSlug(slug);
    const p = profiles.find((x) => x.slug === slug);
    if (p?.channelTheme !== undefined) setChannelTheme(p.channelTheme);
    if (p?.defaultAudience !== undefined) setAudience(p.defaultAudience);
  }

  async function generateIdeas() {
    setFormError(null);
    setIdeasMeta(null);
    try {
      const { batchId: id } = await api.startBatch({ channelTheme, audience, count: Number(count) || 10, profileSlug });
      setBatchId(id);
    } catch (err) {
      setFormError(err.message);
    }
  }

  function patchIdea(ideaId, patch) {
    setIdeasMeta((prev) => {
      if (!prev) return prev;
      const ideas = prev.ideas.map((i) => (i.ideaId === ideaId ? { ...i, ...patch } : i));
      api.saveBatchIdeas(batchId, ideas).catch(() => {}); // best-effort persist, matches SceneGrid's immediate-persist convention
      return { ...prev, ideas };
    });
  }

  function deleteIdea(ideaId) {
    setIdeasMeta((prev) => {
      if (!prev) return prev;
      const ideas = prev.ideas.filter((i) => i.ideaId !== ideaId);
      api.saveBatchIdeas(batchId, ideas).catch(() => {});
      return { ...prev, ideas };
    });
  }

  async function runApproval() {
    const keptIdeas = (ideasMetaRef.current?.ideas ?? []).filter((i) => i.kept !== false);
    if (!keptIdeas.length) return;
    if (!window.confirm(`Tạo ${keptIdeas.length} project từ các ý tưởng đang giữ? Mỗi ý tưởng sẽ gọi content-planner thật (tốn phí).`)) {
      return;
    }
    setApproving(true);
    setFormError(null);
    for (const idea of keptIdeas) {
      const current = ideasMetaRef.current.ideas.find((i) => i.ideaId === idea.ideaId);
      if (current?.status === "done") continue; // resume support after reload mid-batch
      try {
        patchIdea(idea.ideaId, { status: "creating", error: null });
        const { id: projectId, platform } = await createProjectWithRetry(idea.idea, orientation);
        patchIdea(idea.ideaId, { status: "planning", projectId, platform });
        await api.runPlan(projectId, { idea: idea.idea, audience, platform });
        await waitForProjectStep(projectId, "plan");
        patchIdea(idea.ideaId, { status: "done" });
        await api
          .appendIdeaHistory(profileSlug, { idea: idea.idea, subTopic: idea.subTopic, hookStyle: idea.hookStyle, tone: idea.tone, projectId })
          .catch(() => {});
      } catch (err) {
        patchIdea(idea.ideaId, { status: "error", error: err.message });
      }
    }
    setApproving(false);
  }

  const ideas = ideasMeta?.ideas ?? [];
  const keptCount = ideas.filter((i) => i.kept !== false).length;

  return (
    <div>
      <div className="card">
        <h2>Hàng loạt — sinh nhiều ý tưởng video từ 1 chủ đề kênh</h2>
        <p className="muted">
          Chọn 1 channel profile, nhập chủ đề kênh cố định + đối tượng xem, hệ thống tự sinh N ý tưởng khác nhau để anh
          duyệt/sửa/xoá trước khi tạo project thật.
        </p>

        <select value={profileSlug} onChange={(e) => onSelectProfile(e.target.value)} disabled={approving}>
          <option value="">— Chọn channel profile (bắt buộc) —</option>
          {profiles.map((p) => (
            <option key={p.slug} value={p.slug}>{p.name}</option>
          ))}
        </select>

        <textarea
          value={channelTheme}
          onChange={(e) => setChannelTheme(e.target.value)}
          placeholder="Chủ đề kênh — ví dụ: kênh chữa lành, nội dung tình cảm, giọng văn nhẹ nhàng"
          rows={2}
          disabled={approving}
        />
        <input
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="Đối tượng xem — ví dụ: Nữ 20-30 tuổi, hay lo âu"
          disabled={approving}
        />
        <div className="inline-form">
          <label>
            Số lượng ý tưởng:{" "}
            <input type="number" min={1} max={30} value={count} onChange={(e) => setCount(e.target.value)} style={{ width: "70px" }} disabled={approving} />
          </label>
          <fieldset className="orientation-picker">
            <legend>Định dạng</legend>
            <label>
              <input type="radio" name="batch-orientation" checked={orientation === "portrait"} onChange={() => setOrientation("portrait")} />
              Dọc (9:16)
            </label>
            <label>
              <input type="radio" name="batch-orientation" checked={orientation === "landscape"} onChange={() => setOrientation("landscape")} />
              Ngang (16:9)
            </label>
          </fieldset>
        </div>

        <button
          type="button"
          disabled={!profileSlug || !channelTheme.trim() || !audience.trim() || ideateStatus === "running"}
          onClick={generateIdeas}
        >
          {ideateStatus === "running" ? "Đang sinh ý tưởng…" : "Sinh ý tưởng"}
        </button>
        {!profileSlug && <p className="muted">Cần chọn 1 channel profile trước khi sinh ý tưởng.</p>}
        {formError && <p className="error">{formError}</p>}
        {ideateStatus === "running" && <LiveLog events={events} step="ideate" maxLines={6} />}
        {ideateStatus === "error" && <p className="error">{steps.ideate.error}</p>}
      </div>

      {ideas.length > 0 && (
        <div className="card">
          <div className="step-row-head">
            <h3>Ý tưởng ({ideas.length}) — giữ {keptCount}</h3>
            <button type="button" disabled={!keptCount || approving} onClick={runApproval}>
              {approving ? "Đang tạo project…" : `Duyệt & tạo project (${keptCount})`}
            </button>
          </div>
          <div className="idea-grid">
            {ideas.map((idea) => (
              <IdeaCard
                key={idea.ideaId}
                idea={idea}
                disabled={approving}
                onEdit={(text) => patchIdea(idea.ideaId, { idea: text })}
                onToggleKeep={(kept) => patchIdea(idea.ideaId, { kept })}
                onDelete={() => deleteIdea(idea.ideaId)}
                onOpen={onProjectCreated}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
