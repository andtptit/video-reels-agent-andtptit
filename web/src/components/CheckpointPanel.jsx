import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Read-only viewer for a pipeline checkpoint file (scenes.json, video-plan.json, ...)
 *  — re-fetches whenever `refreshKey` changes (caller passes the owning step's
 *  status.at so it reloads right after that step reports "done"). */
export function CheckpointPanel({ id, file, title, refreshKey }) {
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.getFile(id, file).then(setContent).catch((err) => setError(err.message));
  }, [id, file, refreshKey]);

  if (error) return null;
  if (!content) return null;

  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);

  return (
    <div className="card">
      <button type="button" className="linklike" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} {title} ({file})
      </button>
      {open && <pre className="checkpoint">{text}</pre>}
    </div>
  );
}
