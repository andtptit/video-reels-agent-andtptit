const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001";

async function request(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: options?.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error(body?.error || `${res.status} ${res.statusText}`);
  return body;
}

export const api = {
  base: API_BASE,
  listProjects: () => request("/projects"),
  createProject: (idea, orientation) => request("/projects", { method: "POST", body: JSON.stringify({ idea, orientation }) }),
  getProject: (id) => request(`/projects/${encodeURIComponent(id)}`),
  getFile: (id, name) => request(`/projects/${encodeURIComponent(id)}/files/${name}`),
  runPlan: (id, params) => request(`/projects/${encodeURIComponent(id)}/plan`, { method: "POST", body: JSON.stringify(params) }),
  runAudio: (id, params) => request(`/projects/${encodeURIComponent(id)}/audio`, { method: "POST", body: JSON.stringify(params ?? {}) }),
  runVideoPlan: (id, params) => request(`/projects/${encodeURIComponent(id)}/video-plan`, { method: "POST", body: JSON.stringify(params ?? {}) }),
  runRemix: (id, params) => request(`/projects/${encodeURIComponent(id)}/remix`, { method: "POST", body: JSON.stringify(params ?? {}) }),
  setEffects: (id, effects) => request(`/projects/${encodeURIComponent(id)}/video-plan/effects`, { method: "POST", body: JSON.stringify(effects) }),
  runScene: (id, sceneId) => request(`/projects/${encodeURIComponent(id)}/scenes/${sceneId}/generate`, { method: "POST" }),
  runRoot: (id) => request(`/projects/${encodeURIComponent(id)}/root`, { method: "POST" }),
  runRender: (id) => request(`/projects/${encodeURIComponent(id)}/render`, { method: "POST" }),
  getPreviewUrl: (id) => request(`/projects/${encodeURIComponent(id)}/preview-url`),
  listRenders: (id) => request(`/projects/${encodeURIComponent(id)}/renders`),
  renderUrl: (id, name) => `${API_BASE}/projects/${encodeURIComponent(id)}/renders/${encodeURIComponent(name)}`,
  imageUrl: (id, sceneId) => `${API_BASE}/projects/${encodeURIComponent(id)}/images/${encodeURIComponent(sceneId)}.png`,
  audioUrl: (id, sceneId) => `${API_BASE}/projects/${encodeURIComponent(id)}/audio/${encodeURIComponent(sceneId)}_vo.mp3`,
  eventsUrl: (id) => `${API_BASE}/projects/${encodeURIComponent(id)}/events`,
  listMusicLibrary: () => request("/music-library"),
  listProfiles: () => request("/profiles"),
  saveProfile: (name, data) => request(`/profiles/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProfile: (slug) => request(`/profiles/${encodeURIComponent(slug)}`, { method: "DELETE" }),
  openFolder: (id) => request(`/projects/${encodeURIComponent(id)}/open-folder`, { method: "POST" }),
  deleteProject: (id) => request(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // "Hàng loạt" (Batch) tab — see components/Batch.jsx.
  startBatch: (params) => request("/batches", { method: "POST", body: JSON.stringify(params) }),
  getBatch: (id) => request(`/batches/${encodeURIComponent(id)}`),
  saveBatchIdeas: (id, ideas) => request(`/batches/${encodeURIComponent(id)}/ideas`, { method: "PUT", body: JSON.stringify({ ideas }) }),
  batchEventsUrl: (id) => `${API_BASE}/batches/${encodeURIComponent(id)}/events`,
  appendIdeaHistory: (slug, entry) => request(`/profiles/${encodeURIComponent(slug)}/idea-history`, { method: "POST", body: JSON.stringify(entry) }),
};
