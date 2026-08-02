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

  useEffect(() => {
    api.getFile(id, "video-plan.json").then(setVideoPlan).catch((err) => setError(err.message));
  }, [id, refreshKey]);

  if (error) return <p className="error">{error}</p>;
  if (!videoPlan) return null;

  function toggleImage(sceneId) {
    setOpenImages((prev) => {
      const next = new Set(prev);
      next.has(sceneId) ? next.delete(sceneId) : next.add(sceneId);
      return next;
    });
  }

  return (
    <div className="card">
      <h3>Scenes ({videoPlan.scenes?.length ?? 0})</h3>
      <div className="scene-grid">
        {(videoPlan.scenes ?? []).map((scene) => {
          const stepKey = `scene:${scene.sceneId}`;
          const stepStatus = steps[stepKey]?.status;
          return (
            <div key={scene.sceneId} className="scene-card">
              <strong>{scene.sceneId}</strong>
              <div className="muted">{scene.content_shape} · {scene.duration}s</div>
              <div className="step-row-badges">
                <StatusBadge status={stepStatus} />
                <TokenBadge usage={steps[stepKey]?.usage} />
              </div>
              {audioReady && <SceneAudioPreview id={id} sceneId={scene.sceneId} />}
              <button
                type="button"
                disabled={stepStatus === "running"}
                onClick={() => {
                  // Only confirm on a RE-generate — a scene already "done" has a real
                  // AI image on disk (paid for), and image gen only skips if the
                  // filename already exists; if video-plan.json's image_prompt
                  // changed since, a "Generate lại" click can trigger a genuinely
                  // new (billed) image. First-time "Generate" needs no confirm.
                  if (stepStatus === "done" && !window.confirm(`Generate lại "${scene.sceneId}"? Nếu ảnh đã đổi trong video-plan, sẽ tốn phí sinh ảnh mới.`)) {
                    return;
                  }
                  api.runScene(id, scene.sceneId).catch((err) => alert(err.message));
                }}
              >
                {stepStatus === "done" ? "Generate lại" : "Generate"}
              </button>
              {stepStatus === "done" && (
                <button type="button" className="linklike" onClick={() => toggleImage(scene.sceneId)}>
                  {openImages.has(scene.sceneId) ? "Ẩn ảnh" : "Xem ảnh"}
                </button>
              )}
              {stepStatus === "done" && openImages.has(scene.sceneId) && (
                <ScenePreviewImage id={id} sceneId={scene.sceneId} refreshKey={steps[stepKey]?.at} />
              )}
              {stepStatus === "running" && <LiveLog events={events} step={stepKey} maxLines={4} />}
              {steps[stepKey]?.status === "error" && <p className="error">{steps[stepKey].error}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
