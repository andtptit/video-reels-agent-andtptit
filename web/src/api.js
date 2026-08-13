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
  usePlanTestResult: (id, testId, profileSlug) => request(`/projects/${encodeURIComponent(id)}/plan/use-test-result`, { method: "POST", body: JSON.stringify({ testId, profileSlug }) }),
  runAudio: (id, params) => request(`/projects/${encodeURIComponent(id)}/audio`, { method: "POST", body: JSON.stringify(params ?? {}) }),
  runVideoPlan: (id, params) => request(`/projects/${encodeURIComponent(id)}/video-plan`, { method: "POST", body: JSON.stringify(params ?? {}) }),
  runRemix: (id, params) => request(`/projects/${encodeURIComponent(id)}/remix`, { method: "POST", body: JSON.stringify(params ?? {}) }),
  setEffects: (id, effects) => request(`/projects/${encodeURIComponent(id)}/video-plan/effects`, { method: "POST", body: JSON.stringify(effects) }),
  runScene: (id, sceneId) => request(`/projects/${encodeURIComponent(id)}/scenes/${sceneId}/generate`, { method: "POST" }),
  runRoot: (id) => request(`/projects/${encodeURIComponent(id)}/root`, { method: "POST" }),
  runRender: (id) => request(`/projects/${encodeURIComponent(id)}/render`, { method: "POST" }),
  runCaption: (id) => request(`/projects/${encodeURIComponent(id)}/caption`, { method: "POST" }),
  cancelStep: (id, step) => request(`/projects/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({ step }) }),
  getPreviewUrl: (id) => request(`/projects/${encodeURIComponent(id)}/preview-url`),
  listRenders: (id) => request(`/projects/${encodeURIComponent(id)}/renders`),
  renderUrl: (id, name) => `${API_BASE}/projects/${encodeURIComponent(id)}/renders/${encodeURIComponent(name)}`,
  imageUrl: (id, sceneId) => `${API_BASE}/projects/${encodeURIComponent(id)}/images/${encodeURIComponent(sceneId)}.png`,
  audioUrl: (id, sceneId) => `${API_BASE}/projects/${encodeURIComponent(id)}/audio/${encodeURIComponent(sceneId)}_vo.mp3`,
  footageUrl: (id, sceneId) => `${API_BASE}/projects/${encodeURIComponent(id)}/footage/${encodeURIComponent(sceneId)}.mp4`,
  getFootageLibraryInfo: () => request("/footage-library"),
  eventsUrl: (id) => `${API_BASE}/projects/${encodeURIComponent(id)}/events`,
  listMusicLibrary: () => request("/music-library"),
  testImage: (params) => request("/test-image", { method: "POST", body: JSON.stringify(params) }),
  testContentPlan: (params) => request("/test-content-plan", { method: "POST", body: JSON.stringify(params) }),
  getTestContentPlanResult: (testId) => request(`/test-content-plan/${encodeURIComponent(testId)}/result`),
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
  // "Đọc Caption" tab — see components/Hook.jsx. Own profile store + own 4-step
  // chain (no audio/plan/root reuse — see plan.md).
  listHookProfiles: () => request("/hook-profiles"),
  saveHookProfile: (name, data) => request(`/hook-profiles/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteHookProfile: (slug) => request(`/hook-profiles/${encodeURIComponent(slug)}`, { method: "DELETE" }),
  runHookContent: (id, params) => request(`/projects/${encodeURIComponent(id)}/hook/content`, { method: "POST", body: JSON.stringify(params ?? {}) }),
  runHookVideoPlan: (id, params) => request(`/projects/${encodeURIComponent(id)}/hook/video-plan`, { method: "POST", body: JSON.stringify(params ?? {}) }),
  runHookScene: (id) => request(`/projects/${encodeURIComponent(id)}/hook/scene`, { method: "POST" }),
  runHookRoot: (id) => request(`/projects/${encodeURIComponent(id)}/hook/root`, { method: "POST" }),
  scanFootageFolder: (dir) => request(`/footage-library/scan?dir=${encodeURIComponent(dir)}`),
  fetchPexelsFootage: (params, signal) => request("/footage-library/fetch-pexels", { method: "POST", body: JSON.stringify(params), signal }),
  suggestFootageKeyword: (params) => request("/footage-library/suggest-keyword", { method: "POST", body: JSON.stringify(params) }),
  // "Tạo từ audio có sẵn" tab — see components/AudioImport.jsx. Can't reuse request()
  // here: it always sets Content-Type: application/json, but a multipart body needs
  // its boundary set BY the browser (setting Content-Type by hand breaks that).
  runAudioImport: async (id, file, params) => {
    const form = new FormData();
    form.append("audio", file);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== "") form.append(key, value);
    }
    const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(id)}/audio-import`, { method: "POST", body: form });
    const isJson = res.headers.get("content-type")?.includes("application/json");
    const body = isJson ? await res.json() : await res.text();
    if (!res.ok) throw new Error(body?.error || `${res.status} ${res.statusText}`);
    return body;
  },
  // "Bảng điều tra" tab — see components/Investigation.jsx.
  runInvestigationPlan: (id, params) => request(`/projects/${encodeURIComponent(id)}/investigation-plan`, { method: "POST", body: JSON.stringify(params ?? {}) }),
  // "Dán kịch bản có sẵn" tab — see components/ScriptImport.jsx.
  runScriptPlan: (id, params) => request(`/projects/${encodeURIComponent(id)}/script-plan`, { method: "POST", body: JSON.stringify(params ?? {}) }),
  // "Training" Content playbook — see components/ProfileManager.jsx.
  trainPlaybook: (params) => request("/train-playbook", { method: "POST", body: JSON.stringify(params) }),
  getTrainPlaybookResult: (trainId) => request(`/train-playbook/${encodeURIComponent(trainId)}/result`),
  // Training từ 1-5 video đối thủ — multipart, same reasoning as runAudioImport
  // above for not using request().
  trainPlaybookFromVideos: async (files, params) => {
    const form = new FormData();
    for (const file of files) form.append("videos", file);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== "") form.append(key, value);
    }
    const res = await fetch(`${API_BASE}/train-playbook-videos`, { method: "POST", body: form });
    const isJson = res.headers.get("content-type")?.includes("application/json");
    const body = isJson ? await res.json() : await res.text();
    if (!res.ok) throw new Error(body?.error || `${res.status} ${res.statusText}`);
    return body;
  },
};
