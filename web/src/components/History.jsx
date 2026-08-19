import { useEffect, useState } from "react";
import { api } from "../api.js";

function formatDate(mtime) {
  return new Date(mtime).toLocaleString("vi-VN");
}

/** Polls a single project's "caption" step until it leaves "running" — same shape as
 *  Batch.jsx's own waitForProjectStep, kept local here since History.jsx doesn't
 *  otherwise need per-project SSE (would be wasteful to open a live connection per
 *  card just for the rare case a caption still needs generating). */
function waitForCaptionStep(projectId, { pollMs = 1500, timeoutMs = 90_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, reject) => {
    const check = async () => {
      let status;
      try {
        ({ status } = await api.getProject(projectId));
      } catch (err) {
        return reject(err);
      }
      const s = status.steps?.caption;
      if (s?.status === "done") return resolvePromise();
      if (s?.status === "error") return reject(new Error(s.error || "Viết caption thất bại"));
      if (Date.now() > deadline) return reject(new Error("Timeout chờ viết caption"));
      setTimeout(check, pollMs);
    };
    check();
  });
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
  const [generatingCaption, setGeneratingCaption] = useState(false);
  const [captionError, setCaptionError] = useState(null);

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

  async function generateCaption() {
    setGeneratingCaption(true);
    setCaptionError(null);
    try {
      await api.runCaption(project.id);
      await waitForCaptionStep(project.id);
      const text = await api.getFile(project.id, "caption.md");
      setCaption(text);
    } catch (err) {
      setCaptionError(err.message);
    } finally {
      setGeneratingCaption(false);
    }
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
      setExportMsg(r.exported ? `Đã xuất ra output-ready/${r.folder}/${r.destName}.mp4` : "Chưa có render để xuất");
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
      {!caption && (
        <div className="dash-no-caption">
          <p className="muted">Chưa có caption.</p>
          <button type="button" className="linklike" onClick={generateCaption} disabled={generatingCaption}>
            {generatingCaption ? "Đang viết caption..." : "Viết caption"}
          </button>
          {captionError && <p className="error">{captionError}</p>}
        </div>
      )}

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

export function History({ onProjectDeleted, profiles = [] }) {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);
  const [exportingAll, setExportingAll] = useState(false);
  const [exportAllMsg, setExportAllMsg] = useState(null);
  const [selectedSlug, setSelectedSlug] = useState(null); // null = "Tất cả"

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

  // Counts per profile — lets the filter row show "(3)" etc. without a second fetch;
  // projects with no profileSlug (created before profile-tracking existed, or via a
  // flow that never set one) fall under "Tất cả" only, never under a specific chip.
  const countBySlug = {};
  for (const p of projects) {
    if (p.profileSlug) countBySlug[p.profileSlug] = (countBySlug[p.profileSlug] ?? 0) + 1;
  }
  const profilesWithVideos = profiles.filter((pr) => countBySlug[pr.slug]);
  const visibleProjects = selectedSlug ? projects.filter((p) => p.profileSlug === selectedSlug) : projects;

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
      {profilesWithVideos.length > 0 && (
        <div className="app-tabs" style={{ marginBottom: 16, flexWrap: "wrap" }}>
          <button type="button" className={selectedSlug === null ? "active" : ""} onClick={() => setSelectedSlug(null)}>
            Tất cả ({projects.length})
          </button>
          {profilesWithVideos.map((pr) => (
            <button
              key={pr.slug}
              type="button"
              className={selectedSlug === pr.slug ? "active" : ""}
              onClick={() => setSelectedSlug(pr.slug)}
            >
              {pr.name} ({countBySlug[pr.slug]})
            </button>
          ))}
        </div>
      )}
      {!visibleProjects.length && <p className="muted">Profile này chưa có video nào render xong.</p>}
      <div className="dash-grid">
        {visibleProjects.map((p) => (
          <HistoryCard key={p.id} project={p} onDeleted={handleDeleted} />
        ))}
      </div>
    </div>
  );
}
