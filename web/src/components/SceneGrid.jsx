import { useEffect, useState } from "react";
import { api } from "../api.js";
import { StatusBadge } from "./StatusBadge.jsx";
import { TokenBadge } from "./TokenBadge.jsx";
import { LiveLog } from "./LiveLog.jsx";

function ScenePreviewImage({ id, sceneId, refreshKey }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="muted">Scene này không có ảnh AI (style thuần CSS/GSAP).</p>;
  return (
    <img
      key={refreshKey}
      src={api.imageUrl(id, sceneId)}
      alt={sceneId}
      className="scene-preview-image"
      onError={() => setFailed(true)}
    />
  );
}

function ScenePreviewVideo({ id, sceneId, refreshKey }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="muted">Scene này chưa có video footage.</p>;
  return (
    <video
      key={refreshKey}
      src={api.footageUrl(id, sceneId)}
      controls
      muted
      className="scene-preview-image"
      onError={() => setFailed(true)}
    />
  );
}

/** Lets the user listen to a scene's voiceover BEFORE spending on image/scene
 *  generation for it — catches a bad TTS take (wrong pronunciation, wrong rate, or
 *  the silent-failure-turned-loud-error case from generate-audio.mjs) at the cheap
 *  step instead of only noticing in a fully rendered video. */
function SceneAudioPreview({ id, sceneId }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <audio
      controls
      preload="none"
      src={api.audioUrl(id, sceneId)}
      className="scene-audio-player"
      onError={() => setFailed(true)}
    />
  );
}

export function SceneGrid({ id, steps, events, refreshKey, audioReady }) {
  const [videoPlan, setVideoPlan] = useState(null);
  const [error, setError] = useState(null);
  const [openImages, setOpenImages] = useState(() => new Set());
  // Same "Đang huỷ… until job-status confirms" pattern as Pipeline.jsx's StepRow —
  // kept local here (not lifted to Pipeline) since SceneGrid already owns its own
  // transient UI state (openImages) independently.
  const [cancellingSteps, setCancellingSteps] = useState(() => new Set());

  useEffect(() => {
    api.getFile(id, "video-plan.json").then(setVideoPlan).catch((err) => setError(err.message));
  }, [id, refreshKey]);

  useEffect(() => {
    if (!cancellingSteps.size) return;
    setCancellingSteps((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const key of prev) {
        if (steps[key]?.status !== "running") {
          next.delete(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  async function cancelSceneUI(stepKey) {
    setCancellingSteps((prev) => new Set(prev).add(stepKey));
    try {
      await api.cancelStep(id, stepKey);
    } catch {
      /* stale view or transient network error — cleared by the effect above once
         job-status itself settles */
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!videoPlan) return null;

  function toggleImage(sceneId) {
    setOpenImages((prev) => {
      const next = new Set(prev);
      next.has(sceneId) ? next.delete(sceneId) : next.add(sceneId);
      return next;
    });
  }

  // Only scenes not yet "done"/"running" — mirrors the per-scene button's own
  // semantics (first-time generate needs no confirm-per-scene; a scene already done
  // has a real paid AI image/HTML on disk and isn't touched here).
  const pendingScenes = (videoPlan.scenes ?? []).filter((s) => {
    const st = steps[`scene:${s.sceneId}`]?.status;
    return st !== "done" && st !== "running";
  });

  // Firing every request without awaiting is safe: the server's own
  // queues.dashscope (ConcurrencyQueue) already throttles actual concurrent
  // DashScope calls — see routes.mjs/jobs/queue.mjs — this just needs to hand off
  // N requests, not pace them.
  function generateAllPending() {
    if (!pendingScenes.length) return;
    const confirmText =
      videoPlan.template === "footage"
        ? `Generate ${pendingScenes.length} scene chưa xong (${pendingScenes.map((s) => s.sceneId).join(", ")})? Chỉ ghép video từ kho footage cục bộ, không tốn phí.`
        : `Generate ${pendingScenes.length} scene chưa xong (${pendingScenes.map((s) => s.sceneId).join(", ")})? Sẽ gọi DashScope (kèm sinh ảnh AI nếu style có dùng) cho từng scene, có thể tốn phí.`;
    if (!window.confirm(confirmText)) {
      return;
    }
    for (const scene of pendingScenes) {
      api.runScene(id, scene.sceneId).catch((err) => alert(`${scene.sceneId}: ${err.message}`));
    }
  }

  return (
    <div className="card">
      <div className="step-row-head">
        <h3>Scenes ({videoPlan.scenes?.length ?? 0})</h3>
        <button type="button" disabled={!pendingScenes.length} onClick={generateAllPending}>
          Generate tất cả ({pendingScenes.length} chưa xong)
        </button>
      </div>
      <div className="scene-grid">
        {(videoPlan.scenes ?? []).map((scene) => {
          const stepKey = `scene:${scene.sceneId}`;
          const stepStatus = steps[stepKey]?.status;
          return (
            <div key={scene.sceneId} className="scene-card">
              <strong>{scene.sceneId}</strong>
              <div className="muted">{scene.content_shape ? `${scene.content_shape} · ` : ""}{scene.duration}s</div>
              <div className="step-row-badges">
                {cancellingSteps.has(stepKey) ? (
                  <span style={{ color: "#888", fontWeight: 600, fontSize: "0.85em" }}>Đang huỷ…</span>
                ) : (
                  <StatusBadge status={stepStatus} />
                )}
                <TokenBadge usage={steps[stepKey]?.usage} />
              </div>
              {audioReady && <SceneAudioPreview id={id} sceneId={scene.sceneId} />}
              <button
                type="button"
                disabled={stepStatus === "running"}
                onClick={() => {
                  // "footage" doesn't cost anything to re-roll (no LLM/DashScope, just
                  // local ffmpeg) — no confirm needed there, unlike an AI-image scene
                  // where "Generate lại" can trigger a genuinely new billed image.
                  if (
                    stepStatus === "done" &&
                    videoPlan.template !== "footage" &&
                    !window.confirm(`Generate lại "${scene.sceneId}"? Nếu ảnh đã đổi trong video-plan, sẽ tốn phí sinh ảnh mới.`)
                  ) {
                    return;
                  }
                  api.runScene(id, scene.sceneId).catch((err) => alert(err.message));
                }}
              >
                {stepStatus === "done" ? "Generate lại" : "Generate"}
              </button>
              {stepStatus === "running" && (
                <button type="button" className="linklike" disabled={cancellingSteps.has(stepKey)} onClick={() => cancelSceneUI(stepKey)}>
                  Huỷ
                </button>
              )}
              {stepStatus === "done" && (
                <button type="button" className="linklike" onClick={() => toggleImage(scene.sceneId)}>
                  {openImages.has(scene.sceneId)
                    ? videoPlan.template === "footage" ? "Ẩn video" : "Ẩn ảnh"
                    : videoPlan.template === "footage" ? "Xem video" : "Xem ảnh"}
                </button>
              )}
              {stepStatus === "done" && openImages.has(scene.sceneId) && (
                videoPlan.template === "footage" ? (
                  <ScenePreviewVideo id={id} sceneId={scene.sceneId} refreshKey={steps[stepKey]?.at} />
                ) : (
                  <ScenePreviewImage id={id} sceneId={scene.sceneId} refreshKey={steps[stepKey]?.at} />
                )
              )}
              {stepStatus === "running" && <LiveLog events={events} step={stepKey} maxLines={4} />}
              {steps[stepKey]?.status === "error" && <p className="error">{steps[stepKey].error}</p>}
              {steps[stepKey]?.status === "cancelled" && <p className="muted">{steps[stepKey].error}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
