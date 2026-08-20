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

/** Polls a batch's "ideate" step until it leaves "running" — same shape as
 *  waitForProjectStep below, just against /batches instead of /projects. Used only
 *  by generateIdeas' "gộp vào lô cũ" path, which needs to wait for a SEPARATE
 *  scratch batch's ideas before merging them in, without switching the visible
 *  `batchId` over to that scratch batch. */
function waitForBatchIdeate(batchId, { pollMs = 1000, timeoutMs = 180_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, reject) => {
    const check = async () => {
      let status;
      try {
        ({ status } = await api.getBatch(batchId));
      } catch (err) {
        return reject(err);
      }
      const s = status.steps?.ideate;
      if (s?.status === "done") return resolvePromise();
      if (s?.status === "error") return reject(new Error(s.error || "Sinh ý tưởng thất bại"));
      if (Date.now() > deadline) return reject(new Error("Timeout chờ sinh ý tưởng"));
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

// Remembers the LAST ideation batch PER PROFILE across reloads — same mechanism
// Hook.jsx now has for its own single global "last batch", keyed per-profile here
// instead since a user switches between several channel profiles in this tab and
// expects picking one to bring back whatever ideas (done or not-yet-run) were
// generated for it, not just whichever profile was used most recently overall.
// Without this, selecting a profile always started from a blank ideation form even
// though that profile's ideas.json was still sitting on disk untouched.
function batchStorageKey(profileSlug) {
  return `video-reels-agent:batchIdForProfile:${profileSlug}`;
}
function loadStoredBatchId(profileSlug) {
  return profileSlug ? localStorage.getItem(batchStorageKey(profileSlug)) : null;
}
function saveStoredBatchId(profileSlug, id) {
  if (!profileSlug) return;
  if (id) localStorage.setItem(batchStorageKey(profileSlug), id);
  else localStorage.removeItem(batchStorageKey(profileSlug));
}

const BATCH_STEP_TIMEOUT_MS = 15 * 60 * 1000; // generous shared ceiling — this runs
// unattended, so a uniform 15min per step (well above render's own 10min server-side
// cap) is simpler than tuning a tighter timeout per step type.

// If this many CONSECUTIVE step failures across DIFFERENT projects share the exact
// same step + error message, treat it as a systemic problem (bad API key, DashScope
// down, disk full...) rather than N unrelated bad-luck projects, and stop the whole
// batch instead of burning through the rest one-by-one for no reason — see plan.md.
const SYSTEMIC_FAILURE_THRESHOLD = 3;

export function Batch({ onProjectCreated, profiles, onProfilesChanged }) {
  const [profileSlug, setProfileSlug] = useState("");
  const [channelTheme, setChannelTheme] = useState("");
  const [audience, setAudience] = useState("");
  const [count, setCount] = useState(10);
  const [orientation, setOrientation] = useState("portrait");

  const [profileSaveMsg, setProfileSaveMsg] = useState(null);

  // "Kịch bản có sẵn" hàng loạt — nhập nhiều kịch bản tự viết cùng lúc thay vì để AI
  // sinh ý tưởng. Dùng CHUNG batch engine bên dưới (ideas.json, duyệt, chạy tuần tự)
  // — mỗi kịch bản trở thành 1 "idea" có field `scriptText` thay vì hookStyle/tone do
  // AI sinh (xem runApproval's nhánh scriptText, và routes.mjs's /batches/from-scripts).
  const [pasteScriptsText, setPasteScriptsText] = useState("");
  const [scriptsImporting, setScriptsImporting] = useState(false);
  const [scriptsImportError, setScriptsImportError] = useState(null);

  // List display helpers — a batch accumulates ideas/scripts across many sessions
  // (ideas.json never auto-prunes), so once most of them are "done" the grid gets
  // long and unhelpful; hiding done ones lets the user focus on what's still pending.
  const [hideDone, setHideDone] = useState(false);

  const [batchId, setBatchId] = useState(null);
  const [ideasMeta, setIdeasMeta] = useState(null); // full ideas.json envelope
  const [restoring, setRestoring] = useState(false);
  const [approving, setApproving] = useState(false);
  const [formError, setFormError] = useState(null);
  // Found live (user report): "Duyệt & tạo project" only ever ran content-plan, then
  // stopped — the rest of the pipeline needed a SEPARATE "Chạy hàng loạt" click the
  // user didn't know existed, reading as "flow silently stuck". Off by default (each
  // step past content-plan costs real money) — checking this merges both actions into
  // the single "Duyệt" click, per the user's own expectation ("duyệt và chạy tự động").
  const [autoContinueAll, setAutoContinueAll] = useState(false);

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

  // Found live (user report): runApproval() flips an idea's status 3x in quick
  // succession (creating -> planning -> done), each via patchIdea's own fire-and-forget
  // PUT to /batches/:id/ideas. With no ordering guarantee between overlapping in-flight
  // requests, a slower-arriving EARLIER write (e.g. "creating") could land at the
  // server AFTER a faster-arriving LATER write (e.g. "done"), leaving ideas.json
  // permanently stuck on a stale status even though the real pipeline had already
  // finished — reproduced exactly: Pipeline showed content-plan "Xong" while the Batch
  // card stayed frozen on "Đang tạo project...". Chain every save onto the previous
  // one so they always reach the server in the order they were queued.
  const saveQueueRef = useRef(Promise.resolve());
  function persistIdeas(ideas) {
    saveQueueRef.current = saveQueueRef.current.catch(() => {}).then(() => api.saveBatchIdeas(batchId, ideas));
  }

  useEffect(() => {
    if (ideateStatus === "done" && batchId) {
      api.getBatch(batchId).then((r) => setIdeasMeta(r.ideas)).catch((err) => setFormError(err.message));
    }
  }, [ideateStatus, batchId]);

  /** Runs once per `batchId` change — a direct GET rather than waiting on the
   *  SSE-driven effect above, so restoring a profile's saved batch shows its ideas
   *  immediately (no waiting on an SSE "snapshot" round-trip) AND so a stale/deleted
   *  batch id (profile's saved id points at a batch dir that no longer exists) gets
   *  detected and cleared instead of leaving `restoring` spinning forever — an SSE
   *  connection to a 404 batch fails silently, useEventStream has no onerror
   *  handling. Same pattern as Hook.jsx's own restore effect. */
  useEffect(() => {
    if (!batchId) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    setRestoring(true);
    api
      .getBatch(batchId)
      .then((r) => {
        if (!cancelled) setIdeasMeta(r.ideas);
      })
      .catch(() => {
        if (cancelled) return;
        saveStoredBatchId(profileSlug, null);
        setBatchId(null);
        setIdeasMeta(null);
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [batchId]);

  function onSelectProfile(slug) {
    setProfileSlug(slug);
    setFormError(null);
    const p = profiles.find((x) => x.slug === slug);
    if (p?.channelTheme !== undefined) setChannelTheme(p.channelTheme);
    if (p?.defaultAudience !== undefined) setAudience(p.defaultAudience);
    const stored = loadStoredBatchId(slug);
    setBatchId(stored);
    if (!stored) setIdeasMeta(null);
  }

  async function saveThemeToProfile() {
    setProfileSaveMsg(null);
    const p = profiles.find((x) => x.slug === profileSlug);
    if (!p) return;
    try {
      const saved = await api.saveProfile(p.name, { channelTheme, defaultAudience: audience });
      onProfilesChanged?.();
      setProfileSaveMsg(`Đã lưu chủ đề + đối tượng vào profile "${saved.name}" — lần sau chọn profile này sẽ tự điền sẵn.`);
    } catch (err) {
      setProfileSaveMsg(err.message);
    }
  }

  // Loading flag for the MERGE path below (generating more into an existing batch) —
  // separate from `ideateStatus === "running"` because that SSE status is scoped to
  // the currently-displayed `batchId`'s own dir, but a merge-generate runs the agent
  // into a SEPARATE scratch batch first (so it can wait for the result before
  // touching anything) and never switches `batchId` over to it.
  const [merging, setMerging] = useState(false);

  // Splits on a line that's ONLY dashes ("---", "----"...) — chosen over a blank line
  // because a blank line already means something WITHIN one script (a paragraph/beat
  // break the scene-cutter treats as a hint, same convention as the single-script
  // "Kịch bản có sẵn" tab). Title = first non-empty line, truncated — same rough idea
  // as how a project's own slug gets derived from idea text elsewhere.
  function parseScripts(text) {
    return text
      .split(/^-{3,}\s*$/m)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((scriptText) => {
        const firstLine = scriptText.split("\n").find((l) => l.trim())?.trim() ?? "";
        const title = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
        return { title, scriptText };
      });
  }

  async function importScripts() {
    setScriptsImportError(null);
    const scripts = parseScripts(pasteScriptsText);
    if (!scripts.length) {
      setScriptsImportError("Không tìm thấy kịch bản nào — dán ít nhất 1 kịch bản, các kịch bản cách nhau bởi dòng \"---\".");
      return;
    }
    if (!profileSlug) {
      setScriptsImportError("Chọn 1 channel profile trước.");
      return;
    }
    setScriptsImporting(true);
    try {
      const existing = ideasMetaRef.current?.ideas ?? [];
      if (!batchId) {
        const { batchId: id } = await api.createBatchFromScripts({ scripts, profileSlug });
        setBatchId(id);
        saveStoredBatchId(profileSlug, id);
        const { ideas } = await api.getBatch(id);
        setIdeasMeta(ideas);
      } else {
        // Same append-not-overwrite merge as generateIdeas' own merge path — an
        // idea already here (approved or not) must never get silently orphaned by
        // pasting a second round of scripts.
        const maxN = existing.reduce((m, i) => {
          const n = parseInt(String(i.ideaId).replace("idea-", ""), 10);
          return Number.isFinite(n) && n > m ? n : m;
        }, 0);
        const newIdeas = scripts.map((s, i) => ({
          ideaId: `idea-${String(maxN + i + 1).padStart(2, "0")}`,
          idea: s.title,
          scriptText: s.scriptText,
          kept: true,
          status: "pending",
        }));
        const merged = [...existing, ...newIdeas];
        await api.saveBatchIdeas(batchId, merged);
        setIdeasMeta((prev) => ({ ...prev, ideas: merged }));
      }
      setPasteScriptsText("");
    } catch (err) {
      setScriptsImportError(err.message);
    } finally {
      setScriptsImporting(false);
    }
  }

  async function generateIdeas() {
    setFormError(null);
    const existing = ideasMetaRef.current?.ideas ?? [];
    // Found live (user report): sinh 1 lô mới used to OVERWRITE the existing lô
    // outright (new batchId, old one orphaned — unreachable through the UI even
    // though its file was still on disk). Fixed to APPEND instead — any idea already
    // here (approved or not) stays exactly where it is; deleting is still available
    // per-idea via "Xoá", or wholesale via "Bắt đầu batch mới" below.
    const avoidExtra = existing.filter((i) => i.kept !== false).map((i) => `${i.subTopic} — ${i.idea}`);

    if (!batchId) {
      // First-ever batch for this profile session — no merge target yet, adopt
      // directly (same as before).
      try {
        const { batchId: id } = await api.startBatch({ channelTheme, audience, count: Number(count) || 10, profileSlug, avoidExtra });
        setBatchId(id);
        saveStoredBatchId(profileSlug, id);
      } catch (err) {
        setFormError(err.message);
      }
      return;
    }

    setMerging(true);
    try {
      const { batchId: scratchId } = await api.startBatch({ channelTheme, audience, count: Number(count) || 10, profileSlug, avoidExtra });
      await waitForBatchIdeate(scratchId);
      const { ideas: scratchFile } = await api.getBatch(scratchId);
      const newIdeas = scratchFile?.ideas ?? [];
      const maxN = existing.reduce((m, i) => {
        const n = parseInt(String(i.ideaId).replace("idea-", ""), 10);
        return Number.isFinite(n) && n > m ? n : m;
      }, 0);
      const renumbered = newIdeas.map((idea, i) => ({ ...idea, ideaId: `idea-${String(maxN + i + 1).padStart(2, "0")}` }));
      const merged = [...existing, ...renumbered];
      await api.saveBatchIdeas(batchId, merged);
      setIdeasMeta((prev) => ({ ...prev, ideas: merged }));
    } catch (err) {
      setFormError(err.message);
    } finally {
      setMerging(false);
    }
  }

  function patchIdea(ideaId, patch) {
    setIdeasMeta((prev) => {
      if (!prev) return prev;
      const ideas = prev.ideas.map((i) => (i.ideaId === ideaId ? { ...i, ...patch } : i));
      persistIdeas(ideas); // queued, not fired in parallel — see saveQueueRef above
      return { ...prev, ideas };
    });
  }

  function deleteIdea(ideaId) {
    setIdeasMeta((prev) => {
      if (!prev) return prev;
      const ideas = prev.ideas.filter((i) => i.ideaId !== ideaId);
      persistIdeas(ideas);
      return { ...prev, ideas };
    });
  }

  // Applies to whatever's currently VISIBLE (respects "Ẩn project đã chạy xong") —
  // one persisted update instead of N sequential patchIdea calls.
  function setKeptForIds(ideaIds, kept) {
    setIdeasMeta((prev) => {
      if (!prev) return prev;
      const idSet = new Set(ideaIds);
      const ideas = prev.ideas.map((i) => (idSet.has(i.ideaId) ? { ...i, kept } : i));
      persistIdeas(ideas);
      return { ...prev, ideas };
    });
  }

  /** Creates the real project for one idea and promotes an already-generated
   *  /test-content-plan result into it instead of calling content-planner again —
   *  the whole point of TestScriptPreview's "Dùng kết quả này" button (see its own
   *  doc comment): don't pay for the same script twice. Mirrors runApproval's
   *  per-idea creation steps but stops right after content-plan — audio/video-plan/
   *  etc. still go through the normal "Chạy hàng loạt" flow afterward. */
  async function useTestResultForIdea(idea, testId) {
    patchIdea(idea.ideaId, { status: "creating", error: null });
    const { id: projectId, platform } = await createProjectWithRetry(idea.idea, orientation);
    patchIdea(idea.ideaId, { status: "planning", projectId, platform });
    await api.usePlanTestResult(projectId, testId, profileSlug);
    patchIdea(idea.ideaId, { status: "done" });
    await api
      .appendIdeaHistory(profileSlug, { idea: idea.idea, subTopic: idea.subTopic, hookStyle: idea.hookStyle, tone: idea.tone, projectId })
      .catch(() => {});
  }

  async function runApproval() {
    const keptIdeas = (ideasMetaRef.current?.ideas ?? []).filter((i) => i.kept !== false);
    if (!keptIdeas.length) return;

    // Looked up unconditionally now (not just for autoContinueAll) — content-planner's
    // `model` below needs profile.plannerModel regardless of whether the rest of the
    // pipeline runs automatically; previously this was only resolved for the
    // autoContinueAll branch, so a plain "duyệt" approval silently fell back to
    // run-agent.mjs's DEFAULT_MODEL instead of the profile's own chosen model.
    const profile = profiles.find((p) => p.slug === profileSlug);
    if (autoContinueAll && !profile) {
      setFormError("Không tìm thấy profile đã chọn — chọn lại profile trước khi chạy tự động toàn bộ.");
      return;
    }
    const confirmMsg = autoContinueAll
      ? `Tạo ${keptIdeas.length} project VÀ chạy hết pipeline (content-plan→audio→video-plan→scene→root→render) TUẦN TỰ cho từng project? Chạy lâu (có thể hàng giờ), tốn phí thật — không cần ngồi canh nhưng nên theo dõi.`
      : `Tạo ${keptIdeas.length} project từ các ý tưởng đang giữ? Mỗi ý tưởng sẽ gọi content-planner thật (tốn phí).`;
    if (!window.confirm(confirmMsg)) return;

    setApproving(true);
    setFormError(null);
    if (autoContinueAll) {
      stopRequestedRef.current = false;
      recentFailuresRef.current = [];
      setStopRequested(false);
      setPipelineRunError(null);
      setRunningPipeline(true);
    }
    for (const idea of keptIdeas) {
      if (autoContinueAll && stopRequestedRef.current) break;
      const current = ideasMetaRef.current.ideas.find((i) => i.ideaId === idea.ideaId);
      if (current?.status === "done" && !autoContinueAll) continue; // resume support after reload mid-batch
      let projectId = current?.projectId;
      try {
        let platform;
        if (current?.status !== "done") {
          patchIdea(idea.ideaId, { status: "creating", error: null });
          ({ id: projectId, platform } = await createProjectWithRetry(idea.idea, orientation));
          patchIdea(idea.ideaId, { status: "planning", projectId, platform });
          // Kịch bản có sẵn (đã nhập nguyên văn) — cắt cảnh, KHÔNG gọi content-planner
          // (không có gì cho AI viết, chữ đã cố định). routes.mjs's /script-plan cũng
          // đánh dấu step "plan" done y hệt /plan khi xong, nên waitForProjectStep bên
          // dưới dùng chung không cần rẽ nhánh.
          if (idea.scriptText) {
            await api.runScriptPlan(projectId, { scriptText: idea.scriptText, platform, profileSlug });
          } else {
            await api.runPlan(projectId, { idea: idea.idea, audience, platform, profileSlug, model: profile?.plannerModel || undefined });
          }
          await waitForProjectStep(projectId, "plan");
          patchIdea(idea.ideaId, { status: "done" });
          await api
            .appendIdeaHistory(profileSlug, { idea: idea.idea, subTopic: idea.subTopic, hookStyle: idea.hookStyle, tone: idea.tone, projectId })
            .catch(() => {});
        }
        if (autoContinueAll && projectId) {
          await runFullPipelineForProject({ ...idea, projectId }, profile);
        }
      } catch (err) {
        if (err.message === "__stopped__") break;
        patchIdea(idea.ideaId, { status: "error", error: err.message });
      }
    }
    setApproving(false);
    if (autoContinueAll) setRunningPipeline(false);
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
        photoProvider: profile.subStyle === "investigation_board" ? profile.photoProvider : undefined,
        imageStylePrefix: profile.imageStylePrefix,
        fontFamily: profile.template === "sub" || profile.template === "footage" ? profile.fontFamily : undefined,
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
        format: orientation === "landscape" ? "16:9" : "9:16",
        // Found live (user report): "footage" template ran through Batch always hit
        // the shared empty pool ("Kho footage rỗng") even with a real
        // footageLibraryDir saved on the profile — this whole object was simply never
        // sent, unlike Pipeline.jsx's single-video flow which does build it.
        footageConfig:
          profile.template === "footage"
            ? {
                libraryDir: profile.footageLibraryDir || undefined,
                minClipsPerScene: Number(profile.footageMinClips ?? 1),
                maxClipsPerScene: Number(profile.footageMaxClips ?? 3),
                scenesPerClipMin: Number(profile.footageScenesPerClipMin ?? 1),
                scenesPerClipMax: Number(profile.footageScenesPerClipMax ?? 1),
                sceneSfxEnabled: Boolean(profile.footageSceneSfxEnabled),
                minClipSeconds: Number(profile.footageMinSeconds ?? 3),
                maxClipSeconds: Number(profile.footageMaxSeconds ?? 6),
                flipEnabled: Boolean(profile.footageFlipEnabled),
                speedEnabled: Boolean(profile.footageSpeedEnabled),
                speedMin: Number(profile.footageSpeedMin ?? 1.0),
                speedMax: Number(profile.footageSpeedMax ?? 1.3),
                zoomEnabled: Boolean(profile.footageZoomEnabled),
                zoomMin: Number(profile.footageZoomMin ?? 1.05),
                zoomMax: Number(profile.footageZoomMax ?? 1.15),
                colorGrade: profile.footageColorGrade ?? "none",
                captionPosition: profile.captionPosition ?? "bottom",
                fontFamily: profile.fontFamily,
              }
            : undefined,
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
    if (stopRequestedRef.current) return;

    // Found live (user report): batch runs never went past render, so caption.md
    // (the copy-paste-ready Reels caption "Xuất gọn"/History depend on) was missing
    // for almost every video produced this way — see Pipeline.jsx's own
    // runAllPipeline for the same fix on the single-video flow.
    await ensureProjectStep(projectId, "caption", () => api.runCaption(projectId));
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
  const displayedIdeas = hideDone ? ideas.filter((i) => i.status !== "done") : ideas;

  return (
    <div>
      <div className="card">
        <h2>Hàng loạt — sinh nhiều ý tưởng video từ 1 chủ đề kênh</h2>
        <p className="muted">
          Chọn 1 channel profile, nhập chủ đề kênh cố định + đối tượng xem, hệ thống tự sinh N ý tưởng khác nhau để anh
          duyệt/sửa/xoá trước khi tạo project thật. Mỗi profile tự nhớ danh sách ý tưởng đã sinh (chưa chạy vẫn còn) —
          chọn lại profile là thấy lại, không cần sinh lại.
        </p>
        {restoring && <p className="muted">Đang khôi phục danh sách ý tưởng của profile này…</p>}

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
          disabled={!profileSlug || !channelTheme.trim() || !audience.trim() || ideateStatus === "running" || merging}
          onClick={generateIdeas}
        >
          {merging ? "Đang sinh thêm ý tưởng…" : ideateStatus === "running" ? "Đang sinh ý tưởng…" : ideas.length ? "Sinh thêm ý tưởng" : "Sinh ý tưởng"}
        </button>
        {!profileSlug && <p className="muted">Cần chọn 1 channel profile trước khi sinh ý tưởng.</p>}
        {formError && <p className="error">{formError}</p>}
        {ideateStatus === "running" && <LiveLog events={events} step="ideate" maxLines={6} />}
        {ideateStatus === "error" && <p className="error">{steps.ideate.error}</p>}
      </div>

      <div className="card">
        <h2>Hoặc: dán nhiều kịch bản có sẵn</h2>
        <p className="muted">
          Kịch bản bạn tự viết nguyên văn — cắt cảnh 100% bằng code, không AI viết lại chữ nào. Dán nhiều kịch bản cùng
          lúc, mỗi kịch bản cách nhau bởi 1 dòng riêng chỉ có "---". Trong 1 kịch bản, đặt 1 dòng chỉ có "===" ở chỗ
          muốn ngắt scene (không đánh dấu thì tự cắt theo dòng trống). Tiêu đề project tự lấy từ dòng đầu mỗi kịch bản.
        </p>
        <textarea
          value={pasteScriptsText}
          onChange={(e) => setPasteScriptsText(e.target.value)}
          placeholder={"Kịch bản 1, scene 1...\n===\nKịch bản 1, scene 2...\n\n---\n\nKịch bản 2, scene 1...\n===\nKịch bản 2, scene 2..."}
          rows={8}
          disabled={scriptsImporting}
        />
        <button type="button" disabled={!profileSlug || !pasteScriptsText.trim() || scriptsImporting} onClick={importScripts}>
          {scriptsImporting ? "Đang nhập..." : "Nhập kịch bản"}
        </button>
        {!profileSlug && <p className="muted">Cần chọn 1 channel profile trước (ô chọn profile ở trên).</p>}
        {scriptsImportError && <p className="error">{scriptsImportError}</p>}
      </div>

      {ideas.length > 0 && (
        <div className="card">
          <div className="step-row-head">
            <h3>
              Ý tưởng ({displayedIdeas.length}{displayedIdeas.length !== ideas.length ? `/${ideas.length}` : ""}) — giữ {keptCount}
            </h3>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="linklike"
                disabled={approving}
                onClick={() => { saveStoredBatchId(profileSlug, null); setBatchId(null); setIdeasMeta(null); }}
              >
                Bắt đầu batch mới
              </button>
              <button type="button" disabled={!keptCount || approving} onClick={runApproval}>
                {approving ? "Đang tạo project…" : `Duyệt & tạo project (${keptCount})`}
              </button>
            </div>
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={autoContinueAll}
              disabled={approving}
              onChange={(e) => setAutoContinueAll(e.target.checked)}
              style={{ width: "auto", marginBottom: 0 }}
            />
            Chạy tự động luôn cả pipeline (audio→video-plan→scene→root→render) sau khi duyệt — không cần bấm "Chạy hàng loạt" riêng
          </label>
          <div className="inline-form" style={{ marginTop: "8px" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hideDone}
                onChange={(e) => setHideDone(e.target.checked)}
                style={{ width: "auto", marginBottom: 0 }}
              />
              Ẩn project đã chạy xong
            </label>
            <button
              type="button"
              className="linklike"
              disabled={approving || !displayedIdeas.length}
              onClick={() => setKeptForIds(displayedIdeas.map((i) => i.ideaId), true)}
            >
              Chọn hàng loạt
            </button>
            <button
              type="button"
              className="linklike"
              disabled={approving || !displayedIdeas.length}
              onClick={() => setKeptForIds(displayedIdeas.map((i) => i.ideaId), false)}
            >
              Bỏ tích
            </button>
          </div>
          <div className="idea-grid">
            {displayedIdeas.map((idea) => (
              <IdeaCard
                key={idea.ideaId}
                idea={idea}
                disabled={approving}
                onEdit={(text) => patchIdea(idea.ideaId, { idea: text })}
                onToggleKeep={(kept) => patchIdea(idea.ideaId, { kept })}
                onDelete={() => deleteIdea(idea.ideaId)}
                onOpen={(projectId, ideaText, plat) => onProjectCreated(projectId, ideaText, plat, profileSlug)}
                audience={audience}
                platform={orientation === "landscape" ? "16:9" : "9:16"}
                profileSlug={profileSlug}
                onUseTestResult={useTestResultForIdea}
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
