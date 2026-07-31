import { useEffect, useState } from "react";
import { api } from "../api.js";

function formatDate(mtime) {
  return new Date(mtime).toLocaleString("vi-VN");
}

export function ProjectPicker({ onSelect }) {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listProjects().then((r) => setProjects(r.projects)).catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!projects) return <p className="muted">Đang tải danh sách project…</p>;
  if (!projects.length) return null;

  return (
    <div className="card">
      <h3>Project đã có ({projects.length})</h3>
      <div className="project-list">
        {projects.map((p) => (
          <button key={p.id} type="button" className="project-item" onClick={() => onSelect(p.id, p.slug.replace(/-/g, " "))}>
            <strong>{p.slug}</strong>
            <span className="muted">{p.date} · {formatDate(p.mtime)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
