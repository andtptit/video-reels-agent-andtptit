import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useJobStatus } from "../useJobStatus.js";
import { LiveLog } from "./LiveLog.jsx";

function formatDate(mtime) {
  return new Date(mtime).toLocaleString("vi-VN");
}

/**
 * One project's publish card — mirrors History.jsx's HistoryItem for the
 * data-fetching shape (latest render + caption.md), but adds the actual "Đăng lên
 * Facebook Reels" action. Kept as its OWN component (not folded into HistoryItem) per
 * user request: this tab is deliberately separate from every video-CREATION tab, since
 * the whole point of this tool is running many projects in bulk — publish status only
 * matters here, not while a project is still being built.
 */
function PublishCard({ project, page }) {
  const [renders, setRenders] = useState(null);
  const [description, setDescription] = useState("");
  const [localError, setLocalError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { steps, events } = useJobStatus(project.id);

  useEffect(() => {
    api.listRenders(project.id).then((r) => setRenders(r.renders)).catch(() => setRenders([]));
    api.getFile(project.id, "caption.md").then(setDescription).catch(() => {});
  }, [project.id]);

  // routes.mjs's GET /projects/:id/renders sorts newest-mtime-first.
  const latest = renders?.[0];
  const publishStatus = steps["publish-facebook"]?.status;
  const alreadyPublished = publishStatus === "done";
  const publishing = submitting || publishStatus === "running";

  async function publish() {
    setLocalError(null);
    setSubmitting(true);
    try {
      await api.publishFacebookReel(project.id, { description });
    } catch (err) {
      // Validation errors (chưa gắn Page, chưa có token, video ngoài 3-90s...) return
      // synchronously as a 400 from the route BEFORE runStep ever starts — those never
      // reach job-status.json, so they only surface here, not via steps[...].error.
      setLocalError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="scene-card">
      <strong>{project.slug}</strong>
      <span className="muted">{project.date} · {formatDate(project.mtime)}</span>
      {renders === null && <p className="muted">Đang tải render…</p>}
      {latest && <video controls src={api.renderUrl(project.id, latest.name)} style={{ width: "100%", display: "block", borderRadius: "8px" }} />}

      {!page?.facebookPageId ? (
        <p className="muted">
          Profile "{page?.name ?? project.profileSlug ?? "?"}" chưa gắn Facebook Page — vào tab "Hồ sơ kênh" cấu hình
          Page ID + Access Token trước.
        </p>
      ) : (
        <>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Caption đăng kèm video..."
            disabled={publishing || alreadyPublished}
          />
          {alreadyPublished ? (
            <p className="muted">Đã đăng ✓{steps["publish-facebook"]?.at ? ` (${formatDate(new Date(steps["publish-facebook"].at).getTime())})` : ""}</p>
          ) : (
            <button type="button" onClick={publish} disabled={publishing}>
              {publishing ? "Đang đăng..." : "Đăng lên Facebook Reels"}
            </button>
          )}
          {publishing && <LiveLog events={events} step="publish-facebook" />}
          {localError && <p className="error">{localError}</p>}
          {!localError && publishStatus === "error" && <p className="error">{steps["publish-facebook"]?.error}</p>}
        </>
      )}
    </div>
  );
}

export function Publish({ profiles }) {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listProjects()
      .then((r) => setProjects((r.projects ?? []).filter((p) => p.renderDone)))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!projects) return <p className="muted">Đang tải…</p>;
  if (!projects.length) return <p className="muted">Chưa có video nào render xong.</p>;

  return (
    <div className="card">
      <p className="muted">{projects.length} video đã render xong, sẵn sàng đăng</p>
      <div className="scene-grid">
        {projects.map((p) => (
          <PublishCard key={p.id} project={p} page={profiles.find((prof) => prof.slug === p.profileSlug)} />
        ))}
      </div>
    </div>
  );
}
