import { useEffect, useState } from "react";
import { api } from "../api.js";

function formatDate(mtime) {
  return new Date(mtime).toLocaleString("vi-VN");
}

function HistoryItem({ project, onDeleted }) {
  const [renders, setRenders] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listRenders(project.id).then((r) => setRenders(r.renders)).catch(() => setRenders([]));
  }, [project.id]);

  // routes.mjs's GET /projects/:id/renders already sorts newest-mtime-first.
  const latest = renders?.[0];

  async function openFolder() {
    setError(null);
    try {
      await api.openFolder(project.id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteProject() {
    // Plain window.confirm (same pattern as ProjectPicker's profile delete) but with
    // the wording made explicit about what's actually lost — this destroys real
    // paid-for AI images/audio, not just a UI list entry.
    const ok = window.confirm(
      `Xoá VĨNH VIỄN project "${project.slug}"?\n\nGồm toàn bộ ảnh AI đã tốn phí sinh, audio, video đã render, và mọi file khác trong thư mục — KHÔNG THỂ HOÀN TÁC.`
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteProject(project.id);
      onDeleted(project.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="card history-item">
      <div className="step-row-head">
        <strong>{project.slug}</strong>
        <span className="muted">{project.date} · {formatDate(project.mtime)}</span>
      </div>
      {project.remixedFrom && <p className="muted">remix từ {project.remixedFrom.split("/")[1]}</p>}
      {renders === null && <p className="muted">Đang tải render…</p>}
      {latest && <video controls className="render-video" src={api.renderUrl(project.id, latest.name)} />}
      {renders?.length > 1 && <p className="muted">+{renders.length - 1} bản render khác trong thư mục (đang xem bản mới nhất)</p>}
      <div className="inline-form">
        <button type="button" onClick={openFolder}>Mở thư mục output</button>
        <button type="button" className="linklike" onClick={deleteProject} disabled={busy}>
          {busy ? "Đang xoá..." : "Xoá project"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function History({ onProjectDeleted }) {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    load();
  }, []);

  function load() {
    api.listProjects()
      .then((r) => setProjects((r.projects ?? []).filter((p) => p.renderDone)))
      .catch((err) => setError(err.message));
  }

  function handleDeleted(id) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    onProjectDeleted?.(id);
  }

  if (error) return <p className="error">{error}</p>;
  if (!projects) return <p className="muted">Đang tải…</p>;
  if (!projects.length) return <p className="muted">Chưa có video nào render xong.</p>;

  return (
    <div>
      <p className="muted">{projects.length} video đã render xong</p>
      {projects.map((p) => (
        <HistoryItem key={p.id} project={p} onDeleted={handleDeleted} />
      ))}
    </div>
  );
}
