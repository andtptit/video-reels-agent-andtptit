import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useBatchStatus } from "../useJobStatus.js";
import { LiveLog } from "./LiveLog.jsx";
import { IdeaCard } from "./IdeaCard.jsx";
import { StatusBadge } from "./StatusBadge.jsx";

/** Waits until `api.getProject(projectId).status.steps[stepKey]` leaves "running" —
 *  same polling shape as Pipeline.jsx's own `waitForStep`, just re-pointed at a new
 *  project id every call instead of one fixed project. Also settles on "cancelled"
 *  (rejects, same as "error") — needed once "Chạy hàng loạt" below can hit its own
 *  Huỷ button mid-step. */
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
      if (s?.status === "cancelled") return reject(new Error(s.error || `Bước "${stepKey}" đã bị huỷ`));
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

const BATCH_STEP_TIMEOUT_MS = 15 * 60 * 1000; // generous shared ceiling — this runs
// unattended, so a uniform 15min per step (well above render's own 10min server-side
// cap) is simpler than tuning a tighter timeout per step type.

// If this many CONSECUTIVE step failures across DIFFERENT projects share the exact
// same step + error message, treat it as a systemic problem (bad API key, DashScope
// down, disk full...) rather than N unrelated bad-luck projects, and stop the whole
// batch instead of burning through the rest one-by-one for no reason — see plan.md.
const SYSTEMIC_FAILURE_THRESHOLD = 3;

export function Batch({ onProjectCreated }) {
  const [profiles, setProfiles] = useState([]);
  const [profileSlug, setProfileSlug] = useState("");
  const [channelTheme, setChannelTheme] = useState("");
  const [audience, setAudience] = useState("");
  const [count, setCount] = useState(10);
  const [orientation, setOrientation] = useState("portrait");

  const [profileSaveMsg, setProfileSaveMsg] = useState(null);

  const [batchId, setBatchId] = useState(null);
  const [ideasMeta, setIdeasMeta] = useState(null); // full ideas.json envelope
  const [approving, setApproving] = useState(false);
  const [formError, setFormError] = useState(null);

  // "Chạy hàng loạt" — full pipeline (audio→video-plan→scene→root→render), tuần tự
  // qua từng project đã duyệt, cấu hình lấy thẳng từ profile đã chọn ở trên.
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [pipelineRunError, setPipelineRunError] = useState(null);
  const [runProgress, setRunProgress] = useState({}); // { [projectId]: { ideaText, step, status, error } }
  const [stopRequested, setStopRequested] = useState(false);
  // Refs mirror the 2 state values above for synchronous reads inside the async loop
  // (state updates are async and the loop spans many `await`s — a stale closure over
  // plain state would miss a stop request that landed mid-await).
  const stopRequestedRef = useRef(false);
  const currentRunningRef = useRef(null); // { projectId, step } in-flight right now — target for "Dừng toàn bộ"
  const recentFailuresRef = useRef([]); // last few {step, message} failures, for systemic-failure detection

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

  // saveProfile() overwrites the whole profile with exactly the fields sent — spread
  // the ALREADY-LOADED profile object (from listProfiles(), still has every other
  // field: template, imageStylePrefix, models...) instead of sending only
  // channelTheme/audience, or this would silently wipe the rest of the profile.
  async function saveThemeToProfile() {
    setProfileSaveMsg(null);
    const p = profiles.find((x) => x.slug === profileSlug);
    if (!p) return;
    try {
      const saved = await api.saveProfile(p.name, { ...p, channelTheme, defaultAudience: audience });
      const r = await api.listProfiles();
      setProfiles(r.profiles ?? []);
      setProfileSaveMsg(`Đã lưu chủ đề + đối tượng vào profile "${saved.name}" — lần sau chọn profile này sẽ tự điền sẵn.`);
    } catch (err) {
      setProfileSaveMsg(err.message);
    }
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

  function updateProgress(projectId, patch) {
    setRunProgress((prev) => ({ ...prev, [projectId]: { ...prev[projectId], ...patch } }));
  }

  /** Fires `fireFn` (a POST .../<step> call) and waits for job-status to leave
   *  "running" — mirrors Pipeline.jsx's ensureStepDone/waitForStep, just against a
   *  project id that changes every outer-loop iteration instead of one fixed id. */
  async function runStepOnce(projectId, stepKey, fireFn) {
    currentRunningRef.current = { projectId, step: stepKey };
    updateProgress(projectId, { step: stepKey, status: "running", error: null });
    try {
      await fireFn();
      const result = await waitForProjectStep(projectId, stepKey, { timeoutMs: BATCH_STEP_TIMEOUT_MS });
      updateProgress(projectId, { step: stepKey, status: "done" });
      return result;
    } finally {
      currentRunningRef.current = null;
    }
  }

  /** 1 retry per step (quyết định đã chốt: 2 lần thử tổng cộng) — a step still
   *  failing after 1 retry gets recorded for systemic-failure detection, since a
   *  transient blip should self-heal on the first retry; a REPEATED identical
   *  failure across different projects looks more like a real outage than bad luck. */
  async function runStepWithRetry(projectId, stepKey, fireFn) {
    if (stopRequestedRef.current) throw new Error("__stopped__");
    try {
      return await runStepOnce(projectId, stepKey, fireFn);
    } catch (err) {
      if (stopRequestedRef.current || err.message === "__stopped__") throw err;
      updateProgress(projectId, { step: stepKey, status: "retrying", error: err.message });
      try {
        const result = await runStepOnce(projectId, stepKey, fireFn);
        recentFailuresRef.current = []; // a success breaks any in-progress failure streak
        return result;
      } catch (err2) {
        updateProgress(projectId, { step: stepKey, status: "error", error: err2.message });
        recentFailuresRef.current.push({ step: stepKey, message: err2.message });
        const recent = recentFailuresRef.current.slice(-SYSTEMIC_FAILURE_THRESHOLD);
        if (recent.length === SYSTEMIC_FAILURE_THRESHOLD && recent.every((f) => f.step === stepKey && f.message === err2.message)) {
          stopRequestedRef.current = true;
          setStopRequested(true);
          setPipelineRunError(
            `Có vẻ lỗi hệ thống (không phải lỗi riêng 1 project) ở bước "${stepKey}" — đã tự dừng hàng loạt: ${err2.message}`
          );
        }
        throw err2;
      }
    }
  }

  /** Skips a step already "done" (resume support — same reasoning as runApproval's
   *  own resume-by-status check, but reading job-status fresh each time since a
   *  project's steps can only be inspected via the server, not local state here). */
  async function ensureProjectStep(projectId, stepKey, fireFn) {
    const { status } = await api.getProject(projectId);
    if (status.steps?.[stepKey]?.status === "done") {
      updateProgress(projectId, { step: stepKey, status: "done" });
      return;
    }
    await runStepWithRetry(projectId, stepKey, fireFn);
  }

  async function runFullPipelineForProject(idea, profile) {
    const projectId = idea.projectId;
    updateProgress(projectId, { ideaText: idea.idea, step: "audio", status: "pending" });

    await ensureProjectStep(projectId, "audio", () =>
      api.runAudio(projectId, {
        ttsProvider: profile.ttsProvider,
        ttsRate: profile.ttsRate,
        ttsVoice: profile.ttsVoice,
        musicTrack: profile.musicTrack,
        musicVolume: profile.musicVolume,
      })
    );
    if (stopRequestedRef.current) return;

    await ensureProjectStep(projectId, "video-plan", () =>
      api.runVideoPlan(projectId, {
        template: profile.template,
        visualStyle: profile.visualStyle,
        subStyle: profile.subStyle,
        imageStylePrefix: profile.imageStylePrefix,
        fontFamily: profile.fontFamily,
        model: profile.plannerModel,
        cheapModel: profile.cheapModel,
        imageModel: profile.imgModel,
        // Batch runs are exactly the "many videos, same profile" scenario
        // image-library reuse exists for — always on here regardless of what a
        // single-video Pipeline.jsx session happened to have toggled, since that's
        // per-session local state, not something stored on the profile itself.
        imageLibraryEnabled: true,
        profileSlug,
        kenBurns: profile.kenBurns,
        grain: profile.grain,
      })
    );
    if (stopRequestedRef.current) return;

    const videoPlan = await api.getFile(projectId, "video-plan.json");
    for (const scene of videoPlan.scenes ?? []) {
      if (stopRequestedRef.current) return;
      await ensureProjectStep(projectId, `scene:${scene.sceneId}`, () => api.runScene(projectId, scene.sceneId));
    }
    if (stopRequestedRef.current) return;

    await ensureProjectStep(projectId, "root", () => api.runRoot(projectId));
    if (stopRequestedRef.current) return;

    await ensureProjectStep(projectId, "render", () => api.runRender(projectId));
  }

  async function runBatchPipeline() {
    const readyIdeas = (ideasMetaRef.current?.ideas ?? []).filter((i) => i.kept !== false && i.status === "done" && i.projectId);
    if (!readyIdeas.length) return;
    if (
      !window.confirm(
        `Chạy hết pipeline (audio→video-plan→scene→root→render) TUẦN TỰ cho ${readyIdeas.length} project? Chạy lâu (có thể hàng giờ), tốn phí thật — không cần ngồi canh nhưng nên theo dõi.`
      )
    ) {
      return;
    }

    const profile = profiles.find((p) => p.slug === profileSlug);
    if (!profile) {
      setPipelineRunError("Không tìm thấy profile đã chọn — chọn lại profile trước khi chạy hàng loạt.");
      return;
    }

    stopRequestedRef.current = false;
    recentFailuresRef.current = [];
    setStopRequested(false);
    setPipelineRunError(null);
    setRunningPipeline(true);

    for (const idea of readyIdeas) {
      if (stopRequestedRef.current) break;
      try {
        await runFullPipelineForProject(idea, profile);
      } catch {
        // Already recorded on the specific step via runStepWithRetry's own
        // updateProgress — one project failing must not stop the batch (only the
        // systemic-failure check above, or an explicit Dừng toàn bộ, should).
      }
    }

    setRunningPipeline(false);
  }

  /** Huỷ NGAY bước đang chạy dở của project hiện tại (nếu có) + chặn vòng lặp
   *  không tiến sang project tiếp theo — 2 việc cùng lúc, đúng quyết định đã chốt. */
  async function stopBatchPipeline() {
    stopRequestedRef.current = true;
    setStopRequested(true);
    const running = currentRunningRef.current;
    if (running) {
      try {
        await api.cancelStep(running.projectId, running.step);
      } catch {
        /* stale (step already settled) or transient — the loop's own polling will
           notice either way */
      }
    }
  }

  const ideas = ideasMeta?.ideas ?? [];
  const keptCount = ideas.filter((i) => i.kept !== false).length;
  const readyIdeas = ideas.filter((i) => i.kept !== false && i.status === "done" && i.projectId);

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
        {profileSlug && (
          <button
            type="button"
            className="linklike"
            disabled={!channelTheme.trim() || !audience.trim() || approving}
            onClick={saveThemeToProfile}
          >
            Lưu lại vào profile (để lần sau tự điền sẵn)
          </button>
        )}
        {profileSaveMsg && <p className="muted">{profileSaveMsg}</p>}
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
                onOpen={(projectId, ideaText, plat) => onProjectCreated(projectId, ideaText, plat, profileSlug)}
              />
            ))}
          </div>
        </div>
      )}

      {readyIdeas.length > 0 && (
        <div className="card">
          <div className="step-row-head">
            <h3>Chạy hàng loạt — hoàn thiện {readyIdeas.length} video</h3>
            {runningPipeline ? (
              <button type="button" disabled={stopRequested} onClick={stopBatchPipeline}>
                {stopRequested ? "Đang dừng…" : "Dừng toàn bộ hàng loạt"}
              </button>
            ) : (
              <button type="button" onClick={runBatchPipeline}>
                {`Chạy hàng loạt (${readyIdeas.length} project)`}
              </button>
            )}
          </div>
          <p className="muted">
            Chạy TUẦN TỰ từng project (audio→video-plan→scene→root→render), dùng đúng cấu hình của profile đã chọn ở
            trên. Có thể đóng tab và quay lại sau — bấm "Chạy hàng loạt" lần nữa sẽ tự tiếp tục từ project/bước dở
            dang, không chạy lại phần đã xong.
          </p>
          {pipelineRunError && <p className="error">{pipelineRunError}</p>}
          {Object.keys(runProgress).length > 0 && (
            <div className="scene-grid">
              {readyIdeas.map((idea) => {
                const p = runProgress[idea.projectId];
                if (!p) return null;
                return (
                  <div key={idea.projectId} className="scene-card">
                    <strong>{idea.idea}</strong>
                    <div className="muted">{p.step}</div>
                    <StatusBadge status={p.status === "retrying" || p.status === "pending" ? "running" : p.status} />
                    {p.status === "error" && p.error && <p className="error">{p.error}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
