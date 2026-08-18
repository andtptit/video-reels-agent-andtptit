import { useEffect, useState } from "react";
import { api } from "../api.js";

function formatDate(mtime) {
  return new Date(mtime).toLocaleString("vi-VN");
}

// Redesigned per user reference (an external content-dashboard repo's card grid +
// copy-button UX) — same underlying data/actions as the old version (video preview,
// caption copy, open folder, delete), just laid out as a cleaner 2-column card grid
// instead of the generic .scene-grid/.scene-card also shared by SceneGrid/Hook.
function HistoryCard({ project, onDeleted }) {
  const [renders, setRenders] = useState(null);
  const [caption, setCaption] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listRenders(project.id).then((r) => setRenders(r.renders)).catch(() => setRenders([]));
    api.getFile(project.id, "caption.md").then(setCaption).catch(() => setCaption(null));
  }, [project.id]);

  // routes.mjs's GET /projects/:id/renders already sorts newest-mtime-first.
  const latest = renders?.[0];

  function copyCaption() {
    if (!caption) return;
    navigator.clipboard.writeText(caption).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function openFolder() {
    setError(null);
    try {
      await api.openFolder(project.id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function exportReady() {
    setExporting(true);
    setExportMsg(null);
    setError(null);
    try {
      const r = await api.exportProjectReady(project.id);
      setExportMsg(r.exported ? `Đã xuất ra output-ready/${r.destName}.mp4` : "Chưa có render để xuất");
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
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
    <div className="dash-card">
      <div className="dash-card-header">
        <div>
          <strong>{project.slug}</strong>
          <div className="muted" style={{ fontSize: "0.8em" }}>{project.date} · {formatDate(project.mtime)}</div>
          {project.remixedFrom && <div className="muted" style={{ fontSize: "0.8em" }}>remix từ {project.remixedFrom.split("/")[1]}</div>}
        </div>
        {caption && (
          <button type="button" className={`dash-copy-btn${copied ? " copied" : ""}`} onClick={copyCaption}>
            {copied ? "✓ Đã copy" : "Copy caption"}
          </button>
        )}
      </div>

      <div className="dash-card-visual">
        {renders === null && <p className="muted">Đang tải render…</p>}
        {latest && <video controls src={api.renderUrl(project.id, latest.name)} />}
        {renders?.length > 1 && <p className="muted dash-render-count">+{renders.length - 1} bản render khác (đang xem bản mới nhất)</p>}
      </div>

      {caption && <pre className="dash-caption-text">{caption}</pre>}
      {!caption && <p className="muted dash-no-caption">Chưa chạy bước "Đọc Caption" — mở thư mục để xem master_content.md làm caption tạm.</p>}

      <div className="dash-card-actions">
        <button type="button" onClick={openFolder}>Mở thư mục</button>
        <button type="button" className="linklike" onClick={exportReady} disabled={exporting}>
          {exporting ? "Đang xuất…" : "Xuất gọn"}
        </button>
        <button type="button" className="linklike" onClick={deleteProject} disabled={busy}>
          {busy ? "Đang xoá..." : "Xoá"}
        </button>
      </div>
      {exportMsg && <p className="muted">{exportMsg}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function History({ onProjectDeleted }) {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);
  const [exportingAll, setExportingAll] = useState(false);
  const [exportAllMsg, setExportAllMsg] = useState(null);

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

  async function exportAll() {
    setExportingAll(true);
    setExportAllMsg(null);
    try {
      const r = await api.exportAllReady();
      const done = r.results.filter((x) => x.exported).length;
      setExportAllMsg(`Đã xuất ${done}/${r.results.length} video vào ${r.exportDir}`);
    } catch (err) {
      setExportAllMsg(null);
      setError(err.message);
    } finally {
      setExportingAll(false);
    }
  }

  async function openExportFolder() {
    try {
      await api.openExportReadyFolder();
    } catch (err) {
      setError(err.message);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!projects) return <p className="muted">Đang tải…</p>;
  if (!projects.length) return <p className="muted">Chưa có video nào render xong.</p>;

  return (
    <div className="card">
      <div className="dash-toolbar">
        <p className="muted">{projects.length} video đã render xong</p>
        <div className="inline-form" style={{ marginTop: 0 }}>
          <button type="button" onClick={exportAll} disabled={exportingAll}>
            {exportingAll ? "Đang xuất…" : "Xuất tất cả ra output-ready/"}
          </button>
          <button type="button" className="linklike" onClick={openExportFolder}>Mở thư mục output-ready</button>
        </div>
        {exportAllMsg && <p className="muted">{exportAllMsg}</p>}
      </div>
      <div className="dash-grid">
        {projects.map((p) => (
          <HistoryCard key={p.id} project={p} onDeleted={handleDeleted} />
        ))}
      </div>
    </div>
  );
}
