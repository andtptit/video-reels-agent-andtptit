import { useState } from "react";
import { api } from "../api.js";
import { useJobStatus } from "../useJobStatus.js";
import { StatusBadge } from "./StatusBadge.jsx";
import { TokenBadge } from "./TokenBadge.jsx";
import { CheckpointPanel } from "./CheckpointPanel.jsx";
import { SceneGrid } from "./SceneGrid.jsx";
import { PreviewFrame } from "./PreviewFrame.jsx";
import { RenderPlayer } from "./RenderPlayer.jsx";

function StepRow({ title, status, error, usage, children }) {
  return (
    <div className="step-row">
      <div className="step-row-head">
        <strong>{title}</strong>
        <span className="step-row-badges">
          <TokenBadge usage={usage} />
          <StatusBadge status={status} />
        </span>
      </div>
      {children}
      {status === "error" && error && <p className="error">{error}</p>}
    </div>
  );
}

export function Pipeline({ id, idea, platform }) {
  const { steps, totalUsage } = useJobStatus(id);
  const [audience, setAudience] = useState("");
  const [ttsProvider, setTtsProvider] = useState("edge-tts");
  const [formError, setFormError] = useState(null);

  const planStatus = steps.plan?.status;
  const audioStatus = steps.audio?.status;
  const videoPlanStatus = steps["video-plan"]?.status;
  const rootStatus = steps.root?.status;
  const renderStatus = steps.render?.status;
  const doneSceneCount = Object.entries(steps).filter(([key, s]) => key.startsWith("scene:") && s.status === "done").length;

  async function run(fn) {
    setFormError(null);
    try {
      await fn();
    } catch (err) {
      setFormError(err.message);
    }
  }

  return (
    <div>
      <p className="muted">
        Project: {id}
        {totalUsage?.totalTokens ? (
          <>
            {" "}· Tổng token đã dùng: <strong>{totalUsage.totalTokens.toLocaleString("vi-VN")}</strong>
            {" "}· Tổng số lần gọi API: <strong>{(totalUsage.apiCalls ?? 0).toLocaleString("vi-VN")}</strong>
          </>
        ) : null}
      </p>
      {formError && <p className="error">{formError}</p>}

      <StepRow title="1. Content plan" status={planStatus} error={steps.plan?.error} usage={steps.plan?.usage}>
        {planStatus !== "done" && planStatus !== "running" && (
          <div className="inline-form">
            <input
              placeholder="Đối tượng xem (audience) — bắt buộc"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
            />
            <button
              type="button"
              disabled={!audience.trim()}
              onClick={() => run(() => api.runPlan(id, { idea, audience, platform: platform ?? undefined }))}
            >
              Chạy content-planner
            </button>
          </div>
        )}
      </StepRow>
      {planStatus === "done" && (
        <CheckpointPanel id={id} file="scenes.json" title="Scenes (nội dung)" refreshKey={steps.plan?.at} />
      )}

      <StepRow title="2. Audio (TTS)" status={audioStatus} error={steps.audio?.error}>
        {planStatus === "done" && audioStatus !== "done" && audioStatus !== "running" && (
          <div className="inline-form">
            <select value={ttsProvider} onChange={(e) => setTtsProvider(e.target.value)}>
              <option value="edge-tts">edge-tts (free)</option>
              <option value="elevenlabs">elevenlabs</option>
            </select>
            <button type="button" onClick={() => run(() => api.runAudio(id, { ttsProvider }))}>
              Chạy audio
            </button>
          </div>
        )}
      </StepRow>

      <StepRow title="3. Video plan" status={videoPlanStatus} error={steps["video-plan"]?.error} usage={steps["video-plan"]?.usage}>
        {audioStatus === "done" && videoPlanStatus !== "done" && videoPlanStatus !== "running" && (
          <button type="button" onClick={() => run(() => api.runVideoPlan(id))}>
            Chạy video-planner
          </button>
        )}
      </StepRow>
      {videoPlanStatus === "done" && (
        <CheckpointPanel id={id} file="video-plan.json" title="Video plan" refreshKey={steps["video-plan"]?.at} />
      )}

      {videoPlanStatus === "done" && <SceneGrid id={id} steps={steps} refreshKey={steps["video-plan"]?.at} />}

      <StepRow title="4. Ghép video (root)" status={rootStatus} error={steps.root?.error} usage={steps.root?.usage}>
        {videoPlanStatus === "done" && rootStatus !== "running" && (
          <>
            <p className="muted">
              Ghép các scene đã generate ({doneSceneCount}) vào timeline gốc — bắt buộc
              trước khi Render, nếu không video xuất ra sẽ trống/đen.
            </p>
            <button type="button" disabled={doneSceneCount === 0} onClick={() => run(() => api.runRoot(id))}>
              {rootStatus === "done" ? "Ghép lại" : "Ghép video"}
            </button>
          </>
        )}
      </StepRow>
      {rootStatus === "done" && (
        <CheckpointPanel id={id} file="index.html" title="Root composition" refreshKey={steps.root?.at} />
      )}

      <StepRow title="5. Render" status={renderStatus} error={steps.render?.error}>
        {rootStatus === "done" && renderStatus !== "running" && (
          <button type="button" onClick={() => run(() => api.runRender(id))}>
            {renderStatus === "done" ? "Render lại" : "Render"}
          </button>
        )}
        {videoPlanStatus === "done" && rootStatus !== "done" && (
          <p className="muted">Cần hoàn thành bước 4 (Ghép video) trước.</p>
        )}
      </StepRow>
      {renderStatus === "done" && <RenderPlayer id={id} refreshKey={steps.render?.at} />}

      <PreviewFrame id={id} />
      <p className="muted">
        Muốn xem riêng từng scene: mở Preview ở trên, chọn scene tương ứng trong danh
        sách bên trái (mục "Comps") của HyperFrames Studio.
      </p>
    </div>
  );
}
