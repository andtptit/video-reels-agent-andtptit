import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Native <video> player for the most recent rendered .mp4 — separate from
 *  PreviewFrame (which shows the live HyperFrames Studio editor, useful for
 *  per-scene browsing before rendering). This is for the actual output file. */
export function RenderPlayer({ id, refreshKey }) {
  const [renders, setRenders] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listRenders(id).then((r) => setRenders(r.renders)).catch((err) => setError(err.message));
  }, [id, refreshKey]);

  if (error) return <p className="error">{error}</p>;
  if (!renders.length) return null;

  const latest = renders[0];

  return (
    <div className="card">
      <h3>Video đã render</h3>
      <video key={latest.name} controls src={api.renderUrl(id, latest.name)} className="render-video" />
      {renders.length > 1 && (
        <p className="muted">{renders.length} bản render — đang xem bản mới nhất ({latest.name})</p>
      )}
    </div>
  );
}
