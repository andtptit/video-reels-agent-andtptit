import { useEffect, useState } from "react";
import { api } from "../api.js";
import { StatusBadge } from "./StatusBadge.jsx";

export function SceneGrid({ id, steps, refreshKey }) {
  const [videoPlan, setVideoPlan] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getFile(id, "video-plan.json").then(setVideoPlan).catch((err) => setError(err.message));
  }, [id, refreshKey]);

  if (error) return <p className="error">{error}</p>;
  if (!videoPlan) return null;

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
              <StatusBadge status={stepStatus} />
              <button
                type="button"
                disabled={stepStatus === "running"}
                onClick={() => api.runScene(id, scene.sceneId).catch((err) => alert(err.message))}
              >
                {stepStatus === "done" ? "Generate lại" : "Generate"}
              </button>
              {steps[stepKey]?.status === "error" && <p className="error">{steps[stepKey].error}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
