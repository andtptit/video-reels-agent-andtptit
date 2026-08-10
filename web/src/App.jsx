import { useEffect, useState } from "react";
import { api } from "./api.js";
import { ProjectForm } from "./components/ProjectForm.jsx";
import { ProjectPicker } from "./components/ProjectPicker.jsx";
import { ProfileManager } from "./components/ProfileManager.jsx";
import { Pipeline } from "./components/Pipeline.jsx";
import { History } from "./components/History.jsx";
import { Batch } from "./components/Batch.jsx";
import { Hook } from "./components/Hook.jsx";
import { AudioImport } from "./components/AudioImport.jsx";
import { Investigation } from "./components/Investigation.jsx";
import { RunningBanner } from "./components/RunningBanner.jsx";
import "./App.css";

const STORAGE_KEY = "video-reels-agent:lastProject";

function loadStored() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

export default function App() {
  const [project, setProject] = useState(loadStored);
  const [tab, setTab] = useState("pipeline"); // "pipeline" | "history" | "batch" | "hook" | "audio-import" | "investigation"

  // Channel profiles list, lifted up here so ProjectForm's dropdown and
  // ProfileManager's own editor (both rendered on the "no project yet" screen) stay
  // in sync without a page reload — ProfileManager calls refreshProfiles() after any
  // save/delete instead of each component fetching its own independent copy.
  // Pipeline.jsx still fetches its own (unrelated screen, no sync need there).
  const [profiles, setProfiles] = useState([]);
  function refreshProfiles() {
    api.listProfiles().then((r) => setProfiles(r.profiles ?? [])).catch(() => {});
  }
  useEffect(() => {
    refreshProfiles();
  }, []);

  function handleCreated(id, idea, platform, profileSlug) {
    const next = { id, idea, platform, profileSlug };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setProject(next);
    setTab("pipeline");
  }

  function handleSelect(id, ideaGuess) {
    // Existing projects weren't necessarily created through this session, so the
    // exact idea/platform text isn't known — ideaGuess (from the folder slug) only
    // matters if the user re-runs step 1 on a project that never got past creation.
    handleCreated(id, ideaGuess, null);
  }

  function handleReset() {
    localStorage.removeItem(STORAGE_KEY);
    setProject(null);
  }

  function handleProjectDeletedInHistory(id) {
    if (project?.id === id) handleReset();
  }

  return (
    <div className="app">
      <header>
        <h1>Video Reels Agent</h1>
        <nav className="app-tabs">
          <button type="button" className={tab === "pipeline" ? "active" : ""} onClick={() => setTab("pipeline")}>
            Pipeline
          </button>
          <button type="button" className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
            History
          </button>
          <button type="button" className={tab === "batch" ? "active" : ""} onClick={() => setTab("batch")}>
            Hàng loạt
          </button>
          <button type="button" className={tab === "hook" ? "active" : ""} onClick={() => setTab("hook")}>
            Đọc Caption
          </button>
          <button type="button" className={tab === "audio-import" ? "active" : ""} onClick={() => setTab("audio-import")}>
            Từ audio có sẵn
          </button>
          <button type="button" className={tab === "investigation" ? "active" : ""} onClick={() => setTab("investigation")}>
            Bảng điều tra
          </button>
        </nav>
        {project && tab === "pipeline" && (
          <button type="button" className="linklike" onClick={handleReset}>
            + Project mới
          </button>
        )}
      </header>
      <RunningBanner currentProjectId={project?.id} onJump={handleSelect} />
      {tab === "history" ? (
        <History onProjectDeleted={handleProjectDeletedInHistory} />
      ) : tab === "batch" ? (
        <Batch onProjectCreated={handleCreated} />
      ) : tab === "hook" ? (
        <Hook />
      ) : tab === "audio-import" ? (
        <AudioImport onProjectCreated={handleCreated} />
      ) : tab === "investigation" ? (
        <Investigation profiles={profiles} onProjectCreated={handleCreated} />
      ) : !project ? (
        <>
          <ProjectForm onCreated={handleCreated} profiles={profiles} />
          <ProfileManager profiles={profiles} onProfilesChanged={refreshProfiles} />
          <ProjectPicker onSelect={handleSelect} />
        </>
      ) : (
        <Pipeline
          id={project.id}
          idea={project.idea}
          platform={project.platform}
          initialProfileSlug={project.profileSlug}
          onProjectCreated={handleCreated}
        />
      )}
    </div>
  );
}
