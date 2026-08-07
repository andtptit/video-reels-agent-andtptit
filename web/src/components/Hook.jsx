import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useBatchStatus } from "../useJobStatus.js";
import { LiveLog } from "./LiveLog.jsx";
import { IdeaCard } from "./IdeaCard.jsx";
import { StatusBadge } from "./StatusBadge.jsx";

/** Same polling shape as Batch.jsx's own waitForProjectStep — copied rather than
 *  imported since Batch.jsx doesn't export it (keeping this tab fully decoupled, see
 *  plan.md). Settles on "cancelled" too (rejects, same as "error"). */
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

/** Same collision-retry as Batch.jsx's createProjectWithRetry — copied, not imported
 *  (see note above). */
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

// This pipeline has no TTS/per-scene LLM calls (see plan.md) — much cheaper/faster
// than Batch.jsx's own chain, so a shorter per-step ceiling than its 15min is enough.
const HOOK_STEP_TIMEOUT_MS = 5 * 60 * 1000;

// Persists the LAST ideation batch across reloads — same mechanism App.jsx already
// uses for `project` (localStorage + restore on mount). Without this, closing/
// refreshing the tab lost all track of a batch's ideas.json even though the file (and
// every idea's kept/status state) was still sitting on disk the whole time — the
// batch id was the only thing that only ever lived in React state. Deliberately its
// own key, separate from Batch.jsx's own batch flow (that tab has no such persistence
// either today, but fixing this tab doesn't require touching that one — see plan.md's
// "tách biệt hoàn toàn" decision).
const HOOK_BATCH_STORAGE_KEY = "video-reels-agent:hookBatchId";

/** Lazily loads the rendered mp4 + caption.md once "render" is done, for one idea's
 *  finished project — separate small panel rather than routing into Pipeline.jsx
 *  (which doesn't know about template "hook" at all — this tab stays fully
 *  self-contained, per plan.md). */
function HookResultPreview({ projectId, renderDone }) {
  const [renderName, setRenderName] = useState(null);
  const [caption, setCaption] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!renderDone) return;
    api.listRenders(projectId).then((r) => setRenderName(r.renders?.[0]?.name ?? null)).catch(() => {});
    api.getFile(projectId, "caption.md").then(setCaption).catch(() => {});
  }, [projectId, renderDone]);

  if (!renderDone) return null;

  function copy() {
    if (!caption) return;
    navigator.clipboard.writeText(caption).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="hook-preview">
      {renderName && <video src={api.renderUrl(projectId, renderName)} controls style={{ width: "100%", display: "block", borderRadius: "8px" }} />}
      {caption && (
        <div>
          <button type="button" className="linklike" onClick={copy}>{copied ? "Đã copy caption ✓" : "Copy caption"}</button>
          <pre className="checkpoint">{caption}</pre>
        </div>
      )}
    </div>
  );
}

export function Hook() {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileSlug, setSelectedProfileSlug] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileMsg, setProfileMsg] = useState(null);

  const [nicheDescription, setNicheDescription] = useState("");
  const [audience, setAudience] = useState("");
  const [count, setCount] = useState(10);
  const [orientation, setOrientation] = useState("portrait");

  // Cấu hình video — sống trong state của tab này, KHÔNG chỉ đọc lại từ profile lúc
  // chạy (khác cách viết cũ) — cho phép chỉnh nhanh mà không bắt buộc lưu profile
  // trước, đúng pattern applyProfile/saveCurrentAsProfile của Pipeline.jsx.
  const [ctaText, setCtaText] = useState("ĐỌC CAPTION");
  const [highlightColor, setHighlightColor] = useState("#ffb020");
  const [videoDurationSec, setVideoDurationSec] = useState(9);
  const [blurPercent, setBlurPercent] = useState(48); // 48 = same px as the style's original hardcoded value
  const [footageFolder, setFootageFolder] = useState(""); // empty = shared assets/footage-library/
  const [footageScan, setFootageScan] = useState(null); // { count, images, videos, error? } from last "Kiểm tra thư mục"
  const [footageScanLoading, setFootageScanLoading] = useState(false);
  const [footageMinClips, setFootageMinClips] = useState(1);
  const [footageMaxClips, setFootageMaxClips] = useState(3);
  const [footageMinSeconds, setFootageMinSeconds] = useState(3);
  const [footageMaxSeconds, setFootageMaxSeconds] = useState(6);
  const [footageFlipEnabled, setFootageFlipEnabled] = useState(false);
  const [footageSpeedEnabled, setFootageSpeedEnabled] = useState(false);
  const [footageSpeedMin, setFootageSpeedMin] = useState(1.0);
  const [footageSpeedMax, setFootageSpeedMax] = useState(1.3);
  const [musicVolumePercent, setMusicVolumePercent] = useState(18);

  const [batchId, setBatchIdState] = useState(() => localStorage.getItem(HOOK_BATCH_STORAGE_KEY) || null);
  const [ideasMeta, setIdeasMeta] = useState(null); // full ideas.json envelope (reuses the SAME /batches ideation as Batch.jsx)
  const [formError, setFormError] = useState(null);
  const [restoring, setRestoring] = useState(Boolean(localStorage.getItem(HOOK_BATCH_STORAGE_KEY)));

  /** Wraps setBatchId so every place that starts/clears a batch also keeps
   *  localStorage in sync — see HOOK_BATCH_STORAGE_KEY's own doc comment. */
  function setBatchId(id) {
    if (id) localStorage.setItem(HOOK_BATCH_STORAGE_KEY, id);
    else localStorage.removeItem(HOOK_BATCH_STORAGE_KEY);
    setBatchIdState(id);
  }

  const [runProgress, setRunProgress] = useState({}); // { [ideaId]: { ideaText, projectId, step, status, error } }
  const [runningAll, setRunningAll] = useState(false);
  const [runningIdeaId, setRunningIdeaId] = useState(null);

  const { steps, events } = useBatchStatus(batchId);
  const ideateStatus = steps.ideate?.status;

  const ideasMetaRef = useRef(ideasMeta);
  useEffect(() => {
    ideasMetaRef.current = ideasMeta;
  }, [ideasMeta]);

  useEffect(() => {
    api.listHookProfiles().then((r) => setProfiles(r.profiles ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (ideateStatus === "done" && batchId) {
      api.getBatch(batchId).then((r) => setIdeasMeta(r.ideas)).catch((err) => setFormError(err.message));
    }
  }, [ideateStatus, batchId]);

  /** Runs once per `batchId` change (so on the very first mount for a batch restored
   *  from localStorage, AND again whenever generateIdeas() starts a fresh one) — a
   *  direct GET rather than waiting on the SSE-driven effect above, for 2 reasons:
   *  (1) confirms the batch dir still actually exists on disk (a stale/deleted id in
   *  localStorage must not leave `restoring` spinning forever — an SSE connection to
   *  a 404 batch fails silently, useEventStream has no onerror handling), and
   *  (2) prefills the form (niche/audience/count/profile) from the batch's own saved
   *  envelope, so returning to a restored batch shows the same context it was
   *  generated with instead of a blank form next to a populated idea list. */
  useEffect(() => {
    if (!batchId) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    api
      .getBatch(batchId)
      .then((r) => {
        if (cancelled) return;
        setIdeasMeta(r.ideas);
        if (!nicheDescription && r.ideas?.channelTheme) setNicheDescription(r.ideas.channelTheme);
        if (!audience && r.ideas?.audience) setAudience(r.ideas.audience);
        if (!selectedProfileSlug && r.ideas?.profileSlug) setSelectedProfileSlug(r.ideas.profileSlug);
        if (r.ideas?.requestedCount) setCount(r.ideas.requestedCount);
      })
      .catch(() => {
        if (cancelled) return;
        setBatchId(null); // stale/deleted batch — clear so the fresh ideation form shows instead
        setIdeasMeta(null);
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
    // Deliberately keyed only on `batchId` — re-running on every nicheDescription/
    // audience keystroke would defeat the "don't clobber what the user already
    // typed" prefill guard above.
  }, [batchId]);

  /** Applies every field of a saved hook-profile into local state — mirrors
   *  Pipeline.jsx's applyProfile. Fields absent on an older/partial profile are left
   *  at their current value instead of being reset. */
  function applyProfile(p) {
    if (p.nicheDescription !== undefined) setNicheDescription(p.nicheDescription);
    if (p.audience !== undefined) setAudience(p.audience);
    if (p.ctaText !== undefined) setCtaText(p.ctaText);
    if (p.highlightColor !== undefined) setHighlightColor(p.highlightColor);
    if (p.videoDurationSec !== undefined) setVideoDurationSec(p.videoDurationSec);
    if (p.blurPercent !== undefined) setBlurPercent(p.blurPercent);
    if (p.footageFolder !== undefined) setFootageFolder(p.footageFolder);
    if (p.footageMinClips !== undefined) setFootageMinClips(p.footageMinClips);
    if (p.footageMaxClips !== undefined) setFootageMaxClips(p.footageMaxClips);
    if (p.footageMinSeconds !== undefined) setFootageMinSeconds(p.footageMinSeconds);
    if (p.footageMaxSeconds !== undefined) setFootageMaxSeconds(p.footageMaxSeconds);
    if (p.footageFlipEnabled !== undefined) setFootageFlipEnabled(p.footageFlipEnabled);
    if (p.footageSpeedEnabled !== undefined) setFootageSpeedEnabled(p.footageSpeedEnabled);
    if (p.footageSpeedMin !== undefined) setFootageSpeedMin(p.footageSpeedMin);
    if (p.footageSpeedMax !== undefined) setFootageSpeedMax(p.footageSpeedMax);
    if (p.musicVolume !== undefined) setMusicVolumePercent(Math.round(p.musicVolume * 100));
  }

  function onSelectProfile(slug) {
    setSelectedProfileSlug(slug);
    setProfileMsg(null);
    const p = profiles.find((x) => x.slug === slug);
    if (p) {
      applyProfile(p);
      setProfileName(p.name);
    }
  }

  /** Tạo profile MỚI (chưa chọn gì) hoặc cập nhật profile đang chọn — cùng 1 nút,
   *  đúng pattern saveCurrentAsProfile của Pipeline.jsx. Đây là chỗ user yêu cầu bổ
   *  sung: trước đó tab này chỉ có nút "cập nhật" khi ĐÃ có profile chọn sẵn, không
   *  có cách tạo profile mới từ đầu. */
  async function saveCurrentAsProfile() {
    setProfileMsg(null);
    if (!profileName.trim()) {
      setProfileMsg({ ok: false, text: "Nhập tên profile trước đã." });
      return;
    }
    try {
      const saved = await api.saveHookProfile(profileName, {
        nicheDescription, audience, ctaText, highlightColor, videoDurationSec,
        blurPercent, footageFolder,
        footageMinClips, footageMaxClips, footageMinSeconds, footageMaxSeconds,
        footageFlipEnabled, footageSpeedEnabled, footageSpeedMin, footageSpeedMax,
        musicVolume: (Number(musicVolumePercent) || 0) / 100,
      });
      const r = await api.listHookProfiles();
      setProfiles(r.profiles ?? []);
      setSelectedProfileSlug(saved.slug);
      setProfileMsg({ ok: true, text: `Đã lưu profile "${saved.name}".` });
    } catch (err) {
      setProfileMsg({ ok: false, text: err.message });
    }
  }

  async function deleteCurrentProfile() {
    if (!selectedProfileSlug) return;
    const name = profiles.find((p) => p.slug === selectedProfileSlug)?.name ?? selectedProfileSlug;
    if (!window.confirm(`Xoá profile "${name}"? Không thể hoàn tác.`)) return;
    setProfileMsg(null);
    try {
      await api.deleteHookProfile(selectedProfileSlug);
      const r = await api.listHookProfiles();
      setProfiles(r.profiles ?? []);
      setSelectedProfileSlug("");
      setProfileName("");
      setProfileMsg({ ok: true, text: `Đã xoá profile "${name}".` });
    } catch (err) {
      setProfileMsg({ ok: false, text: err.message });
    }
  }

  /** Manual "Kiểm tra thư mục" button rather than live-debounced-as-you-type — a
   *  half-typed path shouldn't fire a request (or, worse, risk creating a stray
   *  folder — see routes.mjs's own existsSync guard) on every keystroke. */
  async function checkFootageFolder() {
    if (!footageFolder.trim()) {
      setFootageScan(null);
      return;
    }
    setFootageScanLoading(true);
    try {
      const r = await api.scanFootageFolder(footageFolder.trim());
      setFootageScan(r);
    } catch (err) {
      setFootageScan({ count: 0, images: 0, videos: 0, error: err.message });
    } finally {
      setFootageScanLoading(false);
    }
  }

  async function generateIdeas() {
    setFormError(null);
    setIdeasMeta(null);
    try {
      // Reuses the SAME /batches ideation route + idea-generator.mjs's rotation/
      // avoid-list diversity mechanism Batch.jsx already uses — it only ever reads
      // channelTheme/audience/profileSlug straight from the request, never any
      // server-side "profile" concept, so it doesn't care that this profileSlug
      // comes from the separate hook-profiles store (see plan.md).
      const { batchId: id } = await api.startBatch({
        channelTheme: nicheDescription,
        audience,
        count: Number(count) || 10,
        profileSlug: selectedProfileSlug || undefined,
      });
      setBatchId(id);
    } catch (err) {
      setFormError(err.message);
    }
  }

  function patchIdea(ideaId, patch) {
    setIdeasMeta((prev) => {
      if (!prev) return prev;
      const ideas = prev.ideas.map((i) => (i.ideaId === ideaId ? { ...i, ...patch } : i));
      api.saveBatchIdeas(batchId, ideas).catch(() => {});
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

  function updateProgress(ideaId, patch) {
    setRunProgress((prev) => ({ ...prev, [ideaId]: { ...prev[ideaId], ...patch } }));
  }

  async function runStepOnce(projectId, stepKey, fireFn) {
    await fireFn();
    return waitForProjectStep(projectId, stepKey, { timeoutMs: HOOK_STEP_TIMEOUT_MS });
  }

  /** 1 retry per step — same decision as Batch.jsx's runStepWithRetry (a transient
   *  blip should self-heal on 1 retry). No systemic-failure auto-stop here (unlike
   *  Batch.jsx): this format has no LLM-heavy step that historically needed it, and
   *  runs are short enough a human is expected to be watching. */
  async function runStepWithRetry(ideaId, projectId, stepKey, fireFn) {
    updateProgress(ideaId, { step: stepKey, status: "running", error: null });
    try {
      await runStepOnce(projectId, stepKey, fireFn);
      updateProgress(ideaId, { step: stepKey, status: "done" });
    } catch (err) {
      updateProgress(ideaId, { step: stepKey, status: "retrying", error: err.message });
      await runStepOnce(projectId, stepKey, fireFn);
      updateProgress(ideaId, { step: stepKey, status: "done" });
    }
  }

  /** Approving 1 idea runs the WHOLE chain immediately — createProject → hook/content
   *  → hook/video-plan → hook/scene → hook/root → render — unlike Batch.jsx's 2-phase
   *  "duyệt" (content-plan only) + separate "chạy hàng loạt" button: this pipeline has
   *  no TTS/per-scene LLM cost, so there's no reason to make the user pause and
   *  trigger a second step (see plan.md). Reads config straight from this tab's own
   *  state (not re-fetched from the profile) — same as Pipeline.jsx's own run
   *  functions, so a tweak made after loading a profile is respected without forcing
   *  a re-save first. */
  async function runIdeaFully(idea) {
    const ideaId = idea.ideaId;
    setRunningIdeaId(ideaId);
    updateProgress(ideaId, { ideaText: idea.idea, step: "project", status: "running", error: null });
    try {
      let projectId = idea.projectId;
      let platform = idea.platform;
      if (!projectId) {
        patchIdea(ideaId, { status: "creating" });
        const created = await createProjectWithRetry(idea.idea, orientation);
        projectId = created.id;
        platform = created.platform;
        patchIdea(ideaId, { status: "planning", projectId, platform });
      }
      updateProgress(ideaId, { projectId });

      const footageConfig = {
        minClipsPerScene: Number(footageMinClips) || 1,
        maxClipsPerScene: Number(footageMaxClips) || 3,
        minClipSeconds: Number(footageMinSeconds) || 3,
        maxClipSeconds: Number(footageMaxSeconds) || 6,
        flipEnabled: footageFlipEnabled,
        speedEnabled: footageSpeedEnabled,
        speedMin: Number(footageSpeedMin) || 1.0,
        speedMax: Number(footageSpeedMax) || 1.3,
      };

      await runStepWithRetry(ideaId, projectId, "hook-content", () =>
        api.runHookContent(projectId, { idea: idea.idea, nicheDescription, ctaText })
      );
      await runStepWithRetry(ideaId, projectId, "hook-video-plan", () =>
        api.runHookVideoPlan(projectId, {
          format: platform || (orientation === "portrait" ? "9:16" : "16:9"),
          videoDurationSec: Number(videoDurationSec) || 9,
          ctaText,
          highlightColor,
          blurPercent: Number(blurPercent),
          footageFolder: footageFolder.trim() || undefined,
          footageConfig,
          musicVolume: (Number(musicVolumePercent) || 0) / 100,
        })
      );
      await runStepWithRetry(ideaId, projectId, "hook-scene", () => api.runHookScene(projectId));
      await runStepWithRetry(ideaId, projectId, "hook-root", () => api.runHookRoot(projectId));
      await runStepWithRetry(ideaId, projectId, "render", () => api.runRender(projectId));

      patchIdea(ideaId, { status: "done" });
      await api
        .appendIdeaHistory(selectedProfileSlug, { idea: idea.idea, subTopic: idea.subTopic, hookStyle: idea.hookStyle, tone: idea.tone, projectId })
        .catch(() => {});
    } catch (err) {
      patchIdea(ideaId, { status: "error", error: err.message });
    } finally {
      setRunningIdeaId(null);
    }
  }

  async function runAllKept() {
    const keptIdeas = (ideasMetaRef.current?.ideas ?? []).filter((i) => i.kept !== false && i.status !== "done");
    if (!keptIdeas.length) return;
    if (!window.confirm(`Tạo & chạy hết ${keptIdeas.length} ý tưởng? Chạy tuần tự, mỗi video mất khoảng 1-2 phút.`)) return;
    setRunningAll(true);
    for (const idea of keptIdeas) {
      const current = ideasMetaRef.current.ideas.find((i) => i.ideaId === idea.ideaId);
      if (current?.status === "done") continue;
      await runIdeaFully(current);
    }
    setRunningAll(false);
  }

  const ideas = ideasMeta?.ideas ?? [];
  const keptCount = ideas.filter((i) => i.kept !== false).length;
  const anyRunning = runningAll || runningIdeaId !== null;

  return (
    <div>
      <div className="card">
        <h2>Đọc Caption — hook card trên nền video mờ, không giọng đọc</h2>
        <p className="muted">
          Profile ở đây hoàn toàn tách biệt khỏi profile của Pipeline/Hàng loạt — lưu riêng cho tab này. Chọn hoặc tạo
          1 niche profile, mô tả niche + đối tượng xem, hệ thống tự sinh N ý tưởng "Top N" khác nhau để anh duyệt/sửa/xoá
          trước khi tạo video thật. Ý tưởng chưa chạy tự động được giữ lại — đóng tab/refresh xong quay lại vẫn còn
          nguyên, không cần sinh lại.
        </p>
        {restoring && <p className="muted">Đang khôi phục danh sách ý tưởng lần trước…</p>}

        <div className="inline-form">
          <select value={selectedProfileSlug} onChange={(e) => onSelectProfile(e.target.value)} disabled={anyRunning} title="Load niche profile đã lưu">
            <option value="">— Chọn niche profile đã lưu (tuỳ chọn) —</option>
            {profiles.map((p) => (
              <option key={p.slug} value={p.slug}>{p.name}</option>
            ))}
          </select>
          <input
            placeholder="Tên profile để lưu (vd: Phụ nữ chăm chồng)"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            disabled={anyRunning}
            style={{ minWidth: "200px" }}
          />
          <button type="button" disabled={anyRunning} onClick={saveCurrentAsProfile}>
            {selectedProfileSlug ? "Cập nhật profile" : "Lưu thành profile mới"}
          </button>
          {selectedProfileSlug && (
            <button type="button" className="linklike" disabled={anyRunning} onClick={deleteCurrentProfile}>
              Xoá profile
            </button>
          )}
        </div>
        {profileMsg && <p className={profileMsg.ok ? "muted" : "error"}>{profileMsg.text}</p>}

        <textarea
          value={nicheDescription}
          onChange={(e) => setNicheDescription(e.target.value)}
          placeholder="Mô tả niche — ví dụ: phụ nữ chăm chồng (cách giữ chồng, nấu ăn, quan tâm cảm xúc...)"
          rows={2}
          disabled={anyRunning}
        />
        <input
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="Đối tượng xem — ví dụ: Phụ nữ đã lập gia đình 25-40 tuổi"
          disabled={anyRunning}
        />

        <div className="inline-form">
          <label>
            Số lượng ý tưởng:{" "}
            <input type="number" min={1} max={30} value={count} onChange={(e) => setCount(e.target.value)} style={{ width: "70px" }} disabled={anyRunning} />
          </label>
          <fieldset className="orientation-picker">
            <legend>Định dạng</legend>
            <label>
              <input type="radio" name="hook-orientation" checked={orientation === "portrait"} onChange={() => setOrientation("portrait")} />
              Dọc (9:16)
            </label>
            <label>
              <input type="radio" name="hook-orientation" checked={orientation === "landscape"} onChange={() => setOrientation("landscape")} />
              Ngang (16:9)
            </label>
          </fieldset>
        </div>

        <button
          type="button"
          disabled={!nicheDescription.trim() || !audience.trim() || ideateStatus === "running"}
          onClick={generateIdeas}
        >
          {ideateStatus === "running" ? "Đang sinh ý tưởng…" : "Sinh ý tưởng"}
        </button>
        {formError && <p className="error">{formError}</p>}
        {ideateStatus === "running" && <LiveLog events={events} step="ideate" maxLines={6} />}
        {ideateStatus === "error" && <p className="error">{steps.ideate.error}</p>}
      </div>

      <div className="card">
        <h3>Cấu hình video</h3>
        <div className="inline-form">
          <label>
            CTA:{" "}
            <input value={ctaText} onChange={(e) => setCtaText(e.target.value)} disabled={anyRunning} style={{ width: "160px" }} />
          </label>
          <label>
            Màu highlight:{" "}
            <input type="color" value={highlightColor} onChange={(e) => setHighlightColor(e.target.value)} disabled={anyRunning} style={{ width: "48px", padding: "2px" }} />
          </label>
          <label>
            Độ dài video (giây):{" "}
            <input type="number" min={3} max={60} value={videoDurationSec} onChange={(e) => setVideoDurationSec(e.target.value)} disabled={anyRunning} style={{ width: "70px" }} title="Mặc định 9s — cố định cho cả video, không suy ra từ giọng đọc vì thể loại này không có giọng đọc" />
          </label>
          <label>
            Độ mờ nền (%):{" "}
            <input type="number" min={0} max={100} value={blurPercent} onChange={(e) => setBlurPercent(e.target.value)} disabled={anyRunning} style={{ width: "70px" }} title="0 = nét hoàn toàn, 100 = rất mờ" />
          </label>
          <label>
            Âm lượng nhạc nền (%):{" "}
            <input type="number" min={0} max={100} value={musicVolumePercent} onChange={(e) => setMusicVolumePercent(e.target.value)} disabled={anyRunning} style={{ width: "70px" }} />
          </label>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
          <span>Thư mục footage riêng:</span>
          <input
            value={footageFolder}
            onChange={(e) => { setFootageFolder(e.target.value); setFootageScan(null); }}
            placeholder="để trống = dùng kho chung assets/footage-library/"
            disabled={anyRunning}
            style={{ minWidth: "320px" }}
          />
          <button type="button" className="linklike" disabled={anyRunning || !footageFolder.trim() || footageScanLoading} onClick={checkFootageFolder}>
            {footageScanLoading ? "Đang kiểm tra…" : "Kiểm tra thư mục"}
          </button>
          {footageScan && (
            footageScan.error
              ? <span className="error">{footageScan.error}</span>
              : <span className="muted">{footageScan.videos} video + {footageScan.images} ảnh</span>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%", marginTop: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span>Số clip nền/video:</span>
            <input type="number" min="1" value={footageMinClips} onChange={(e) => setFootageMinClips(e.target.value)} disabled={anyRunning} style={{ width: "60px" }} />
            <span>–</span>
            <input type="number" min="1" value={footageMaxClips} onChange={(e) => setFootageMaxClips(e.target.value)} disabled={anyRunning} style={{ width: "60px" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span>Độ dài mỗi đoạn (giây):</span>
            <input type="number" min="0.5" step="0.5" value={footageMinSeconds} onChange={(e) => setFootageMinSeconds(e.target.value)} disabled={anyRunning} style={{ width: "60px" }} />
            <span>–</span>
            <input type="number" min="0.5" step="0.5" value={footageMaxSeconds} onChange={(e) => setFootageMaxSeconds(e.target.value)} disabled={anyRunning} style={{ width: "60px" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <input type="checkbox" checked={footageFlipEnabled} onChange={(e) => setFootageFlipEnabled(e.target.checked)} disabled={anyRunning} style={{ width: "auto", marginBottom: 0 }} />
              Lật ngẫu nhiên (tránh trùng lặp footage)
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <input type="checkbox" checked={footageSpeedEnabled} onChange={(e) => setFootageSpeedEnabled(e.target.checked)} disabled={anyRunning} style={{ width: "auto", marginBottom: 0 }} />
              Tăng tốc ngẫu nhiên
            </label>
            {footageSpeedEnabled && (
              <>
                <input type="number" min="1" step="0.1" value={footageSpeedMin} onChange={(e) => setFootageSpeedMin(e.target.value)} disabled={anyRunning} style={{ width: "60px" }} />
                <span>–</span>
                <input type="number" min="1" step="0.1" value={footageSpeedMax} onChange={(e) => setFootageSpeedMax(e.target.value)} disabled={anyRunning} style={{ width: "60px" }} />
                <span>x</span>
              </>
            )}
          </div>
        </div>
      </div>

      {ideas.length > 0 && (
        <div className="card">
          <div className="step-row-head">
            <h3>Ý tưởng ({ideas.length}) — giữ {keptCount}</h3>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" className="linklike" disabled={anyRunning} onClick={() => { setBatchId(null); setIdeasMeta(null); }}>
                Bắt đầu batch mới
              </button>
              <button type="button" disabled={!keptCount || anyRunning} onClick={runAllKept}>
                {runningAll ? "Đang chạy…" : `Tạo & chạy tất cả (${keptCount})`}
              </button>
            </div>
          </div>
          <div className="idea-grid">
            {ideas.map((idea) => (
              <IdeaCard
                key={idea.ideaId}
                idea={idea}
                disabled={anyRunning}
                onEdit={(text) => patchIdea(idea.ideaId, { idea: text })}
                onToggleKeep={(kept) => patchIdea(idea.ideaId, { kept })}
                onDelete={() => deleteIdea(idea.ideaId)}
                onOpen={(projectId) => api.openFolder(projectId).catch(() => {})}
              />
            ))}
          </div>
        </div>
      )}

      {Object.keys(runProgress).length > 0 && (
        <div className="card">
          <h3>Kết quả</h3>
          <div className="scene-grid">
            {Object.entries(runProgress).map(([ideaId, p]) => (
              <div key={ideaId} className="scene-card">
                <strong>{p.ideaText}</strong>
                <div className="muted">{p.step}</div>
                <StatusBadge status={p.status === "retrying" ? "running" : p.status} />
                {p.status === "error" && p.error && <p className="error">{p.error}</p>}
                {p.projectId && <HookResultPreview projectId={p.projectId} renderDone={p.step === "render" && p.status === "done"} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
