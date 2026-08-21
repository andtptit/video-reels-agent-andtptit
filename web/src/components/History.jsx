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

/** Same shape as Batch.jsx's own waitForProjectStep (that one isn't exported, so
 *  duplicated here rather than reaching across components) — polls a project's given
 *  step until it leaves "running", used by "Tạo biến thể"'s per-scene/root/render
 *  orchestration loop below. */
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

// Redesigned per user reference (an external content-dashboard repo's card grid +
// copy-button UX) — same underlying data/actions as the old version (video preview,
// caption copy, open folder, delete), just laid out as a cleaner 2-column card grid
// instead of the generic .scene-grid/.scene-card also shared by SceneGrid/Hook.
function HistoryCard({ project, onDeleted, selected, onToggleSelect }) {
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
        <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
          {/* "Tạo biến thể" chỉ hợp template "footage" (footage random-pick, không phải
             ảnh AI theo prompt) — card style khác thì không hiện checkbox này. */}
          {project.template === "footage" && onToggleSelect && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onToggleSelect(project.id)}
              style={{ width: "auto", marginTop: "4px" }}
              title="Chọn để tạo biến thể hàng loạt"
            />
          )}
          <div>
            <strong>{project.slug}</strong>
            <div className="muted" style={{ fontSize: "0.8em" }}>{project.date} · {formatDate(project.mtime)}</div>
            {project.remixedFrom && <div className="muted" style={{ fontSize: "0.8em" }}>remix từ {project.remixedFrom.split("/")[1]}</div>}
          </div>
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
  const [selectedDate, setSelectedDate] = useState(""); // "" = "Tất cả ngày"

  // "Tạo biến thể" — cuối ngày tích chọn nhiều video (template "footage") rồi tạo
  // hàng loạt biến thể (đổi footage + nhạc, giữ nguyên kịch bản/giọng đọc gốc).
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [variantFormOpen, setVariantFormOpen] = useState(false);
  const [variantCount, setVariantCount] = useState(1);
  const [libraryDirOverride, setLibraryDirOverride] = useState(""); // "" = giữ nguồn gốc của từng video
  const [musicPool, setMusicPool] = useState([]); // [] = giữ nhạc gốc của từng video
  const [footageFolders, setFootageFolders] = useState([]);
  const [musicTracks, setMusicTracks] = useState([]);
  const [variantRunning, setVariantRunning] = useState(false);
  const [variantProgress, setVariantProgress] = useState(null); // "{done}/{total}"
  const [variantError, setVariantError] = useState(null);

  useEffect(() => {
    load();
    api.listFootageFolders().then((r) => setFootageFolders(r.folders ?? [])).catch(() => {});
    api.listMusicLibrary().then((r) => setMusicTracks(r.tracks ?? [])).catch(() => {});
  }, []);

  function load() {
    api.listProjects()
      .then((r) => setProjects((r.projects ?? []).filter((p) => p.renderDone)))
      .catch((err) => setError(err.message));
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runVariants() {
    const targets = (projects ?? []).filter((p) => selectedIds.has(p.id) && p.template === "footage");
    if (!targets.length) return;
    setVariantRunning(true);
    setVariantError(null);
    const total = targets.length * variantCount;
    let done = 0;
    setVariantProgress(`0/${total}`);
    try {
      for (const project of targets) {
        for (let i = 0; i < variantCount; i++) {
          const musicTrack = musicPool.length ? musicPool[Math.floor(Math.random() * musicPool.length)] : undefined;
          // createProject()'s slugify() hard-truncates to 50 chars — project.slug is
          // often ALREADY at that limit, so appending " bien the N" naively got sliced
          // away entirely, leaving an identical slug to the source and a real
          // "thư mục đã tồn tại" collision (confirmed live). Keep only a short prefix
          // of the source slug + a random/time token that's short enough to always
          // survive the truncation, so every call is guaranteed unique regardless of
          // how long project.slug already is.
          const shortBase = project.slug.slice(0, 25).replace(/-+$/, "");
          const uniqueToken = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
          const { id: newId, sceneIds } = await api.createFootageVariant(project.id, {
            variantIdea: `${shortBase}-bt${i + 1}-${uniqueToken}`,
            libraryDir: libraryDirOverride || undefined,
            musicTrack,
          });
          for (const sceneId of sceneIds) {
            await api.runScene(newId, sceneId);
            await waitForProjectStep(newId, `scene:${sceneId}`);
          }
          await api.runRoot(newId);
          await waitForProjectStep(newId, "root");
          await api.runRender(newId);
          await waitForProjectStep(newId, "render", { timeoutMs: 600_000 });
          done++;
          setVariantProgress(`${done}/${total}`);
        }
      }
      setVariantFormOpen(false);
      setSelectedIds(new Set());
      load();
    } catch (err) {
      setVariantError(err.message);
    } finally {
      setVariantRunning(false);
    }
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

  // Same "count against ALL projects, independent of the other filter" convention as
  // countBySlug above — keeps both filters' displayed counts stable no matter which
  // one the user touches first, at the cost of a count that can read "3" for a date
  // that only has 1 video left once the profile filter is also applied.
  const countByDate = {};
  for (const p of projects) {
    if (p.date) countByDate[p.date] = (countByDate[p.date] ?? 0) + 1;
  }
  const datesAvailable = Object.keys(countByDate).sort((a, b) => (a < b ? 1 : -1)); // newest first

  const visibleProjects = projects.filter(
    (p) => (!selectedSlug || p.profileSlug === selectedSlug) && (!selectedDate || p.date === selectedDate)
  );
  const visibleFootageProjects = visibleProjects.filter((p) => p.template === "footage");
  const selectedCount = visibleFootageProjects.filter((p) => selectedIds.has(p.id)).length;

  function toggleMusicPoolTrack(track) {
    setMusicPool((prev) => (prev.includes(track) ? prev.filter((t) => t !== track) : [...prev, track]));
  }

  return (
    <div className="card">
      <div className="dash-toolbar">
        <p className="muted">{projects.length} video đã render xong</p>
        <div className="inline-form" style={{ marginTop: 0 }}>
          <button type="button" onClick={exportAll} disabled={exportingAll}>
            {exportingAll ? "Đang xuất…" : "Xuất tất cả ra output-ready/"}
          </button>
          <button type="button" className="linklike" onClick={openExportFolder}>Mở thư mục output-ready</button>
          {visibleFootageProjects.length > 0 && (
            <>
              <button
                type="button"
                className="linklike"
                onClick={() =>
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    for (const p of visibleFootageProjects) next.add(p.id);
                    return next;
                  })
                }
              >
                Chọn tất cả footage đang hiển thị
              </button>
              <button
                type="button"
                className="linklike"
                onClick={() =>
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    for (const p of visibleFootageProjects) next.delete(p.id);
                    return next;
                  })
                }
              >
                Bỏ chọn
              </button>
              {selectedCount > 0 && (
                <button type="button" onClick={() => setVariantFormOpen((v) => !v)}>
                  Tạo biến thể cho {selectedCount} video đã chọn
                </button>
              )}
            </>
          )}
        </div>
        {exportAllMsg && <p className="muted">{exportAllMsg}</p>}
        {variantFormOpen && selectedCount > 0 && (
          <div className="card" style={{ marginTop: 12 }}>
            <p className="muted">
              Mỗi video đã chọn sẽ được tạo lại {variantCount} bản, giữ nguyên kịch bản + giọng đọc gốc — chỉ đổi footage
              và nhạc nền. Không gọi AI/TTS, chỉ tốn thời gian dựng + render.
            </p>
            <div className="inline-form">
              <label>
                Số biến thể / video
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={variantCount}
                  onChange={(e) => setVariantCount(Math.max(1, Number(e.target.value) || 1))}
                  style={{ width: "70px" }}
                  disabled={variantRunning}
                />
              </label>
              <label>
                Nguồn footage
                <select value={libraryDirOverride} onChange={(e) => setLibraryDirOverride(e.target.value)} disabled={variantRunning}>
                  <option value="">Giữ nguyên nguồn gốc của từng video</option>
                  {footageFolders.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted" style={{ marginBottom: 4 }}>
              Nhạc nền — không chọn gì thì giữ nguyên nhạc gốc của từng video; chọn 1 vài track để random trong nhóm đó:
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: 12 }}>
              {musicTracks.map((t) => (
                <label key={t} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.9em" }}>
                  <input
                    type="checkbox"
                    checked={musicPool.includes(t)}
                    onChange={() => toggleMusicPoolTrack(t)}
                    disabled={variantRunning}
                    style={{ width: "auto" }}
                  />
                  {t}
                </label>
              ))}
            </div>
            <div className="inline-form" style={{ marginTop: 0 }}>
              <button type="button" onClick={runVariants} disabled={variantRunning}>
                {variantRunning ? `Đang tạo… (${variantProgress})` : "Tạo"}
              </button>
              <button type="button" className="linklike" onClick={() => setVariantFormOpen(false)} disabled={variantRunning}>
                Huỷ
              </button>
            </div>
            {variantError && <p className="error">{variantError}</p>}
          </div>
        )}
      </div>
      <div className="inline-form" style={{ marginTop: 0, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {profilesWithVideos.length > 0 && (
          <div className="app-tabs" style={{ flexWrap: "wrap" }}>
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
        {datesAvailable.length > 1 && (
          <select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={{ width: "auto" }}>
            <option value="">Tất cả ngày</option>
            {datesAvailable.map((d) => (
              <option key={d} value={d}>
                {d} ({countByDate[d]})
              </option>
            ))}
          </select>
        )}
      </div>
      {!visibleProjects.length && <p className="muted">Không có video nào khớp bộ lọc.</p>}
      <div className="dash-grid">
        {visibleProjects.map((p) => (
          <HistoryCard key={p.id} project={p} onDeleted={handleDeleted} selected={selectedIds.has(p.id)} onToggleSelect={toggleSelect} />
        ))}
      </div>
    </div>
  );
}
