import { useState } from "react";
import { api } from "../api.js";

/** Lazy — the preview server only starts once the user asks for it (the backend
 *  spawns `hyperframes preview` on first request to /preview-url). The iframe points
 *  directly at that server's own port rather than a same-origin proxy path — see the
 *  comment in routes.mjs for why a path-prefixed proxy doesn't work with Studio's
 *  root-absolute asset URLs. */
export function PreviewFrame({ id }) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [key, setKey] = useState(0);

  async function open() {
    setLoading(true);
    setError(null);
    try {
      const { url } = await api.getPreviewUrl(id);
      setUrl(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h3>Preview</h3>
      {!url ? (
        <button type="button" onClick={open} disabled={loading}>
          {loading ? "Đang khởi động…" : "Mở preview"}
        </button>
      ) : (
        <>
          <button type="button" onClick={() => setKey((k) => k + 1)}>Reload</button>
          <iframe key={key} title="preview" src={url} className="preview-frame" />
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
