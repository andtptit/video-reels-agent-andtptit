import { useEffect, useState } from "react";
import { api } from "../api.js";

/**
 * Always-visible strip showing every project with a step currently "running" —
 * server-side jobs keep running regardless of which project the browser is looking
 * at (see routes.mjs's runInBackground), so without this the only way to know
 * project B finished while you were on project A was to keep switching over and
 * checking manually. Polls instead of SSE: this needs a cross-project view, and the
 * existing /events stream is scoped to one project dir.
 */
export function RunningBanner({ currentProjectId, onJump }) {
  const [running, setRunning] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await api.listProjects();
        if (!cancelled) setRunning((r.projects ?? []).filter((p) => p.isRunning));
      } catch {
        /* transient — next poll retries */
      }
    }
    poll();
    const timer = setInterval(poll, 6000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const others = running.filter((p) => p.id !== currentProjectId);
  if (!others.length) return null;

  return (
    <div className="running-banner">
      <span className="running-banner-label">Đang chạy nền:</span>
      {others.map((p) => (
        <button key={p.id} type="button" className="running-banner-item" onClick={() => onJump(p.id, p.slug.replace(/-/g, " "))}>
          {p.slug.replace(/-/g, " ")} — {p.label}
        </button>
      ))}
    </div>
  );
}
