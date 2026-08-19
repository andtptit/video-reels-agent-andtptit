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
import { ScriptImport } from "./components/ScriptImport.jsx";
import { Publish } from "./components/Publish.jsx";
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
  const [tab, setTab] = useState("pipeline"); // "pipeline" | "history" | "batch" | "hook" | "audio-import" | "investigation" | "script-import" | "profiles" | "publish"
  // One-shot, NOT persisted to localStorage (unlike `project`) — a hand-off from a
  // flow that already produced real content (audio upload) can ask Pipeline.jsx to
  // auto-run the rest of the pipeline instead of the user re-picking every setting
  // and clicking through each step manually. Deliberately transient: a page reload
  // should land back in the normal manual-review state, not silently re-fire a full
  // pipeline run behind the user's back.
  const [autoStartPipeline, setAutoStartPipeline] = useState(false);

  // Channel profiles list, lifted up here so every tab that reads/edits profiles
  // (ProjectForm, ProfileManager, AudioImport, Investigation, ScriptImport, Batch)
  // stays in sync without a page reload — any of them can call refreshProfiles() after
  // a save/delete and every other tab sees it immediately, instead of each maintaining
  // its own independent fetched-once copy. Found live: Batch.jsx used to fetch its own
  // separate copy on mount, so editing a profile's channelTheme/contentPlaybook in
  // ProfileManager showed correctly there but not in "Hàng loạt" until that tab was
  // re-mounted — same-looking data going stale purely from which tab fetched it last.
  // Pipeline.jsx still fetches its own (unrelated screen, no sync need there).
  const [profiles, setProfiles] = useState([]);
  function refreshProfiles() {
    api.listProfiles().then((r) => setProfiles(r.profiles ?? [])).catch(() => {});
  }
  useEffect(() => {
    refreshProfiles();
  }, []);

  function handleCreated(id, idea, platform, profileSlug, autoRun) {
    const next = { id, idea, platform, profileSlug };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setProject(next);
    setAutoStartPipeline(Boolean(autoRun));
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
    setAutoStartPipeline(false);
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
          <button type="button" className={tab === "publish" ? "active" : ""} onClick={() => setTab("publish")}>
            Đăng bài
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
          <button type="button" className={tab === "script-import" ? "active" : ""} onClick={() => setTab("script-import")}>
            Kịch bản có sẵn
          </button>
          <button type="button" className={tab === "profiles" ? "active" : ""} onClick={() => setTab("profiles")}>
            Hồ sơ kênh
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
        <History onProjectDeleted={handleProjectDeletedInHistory} profiles={profiles} />
      ) : tab === "publish" ? (
        <Publish profiles={profiles} />
      ) : tab === "batch" ? (
        <Batch onProjectCreated={handleCreated} profiles={profiles} onProfilesChanged={refreshProfiles} />
      ) : tab === "hook" ? (
        <Hook />
      ) : tab === "audio-import" ? (
        <AudioImport onProjectCreated={handleCreated} profiles={profiles} />
      ) : tab === "investigation" ? (
        <Investigation profiles={profiles} onProjectCreated={handleCreated} />
      ) : tab === "script-import" ? (
        <ScriptImport profiles={profiles} onProjectCreated={handleCreated} />
      ) : tab === "profiles" ? (
        <ProfileManager profiles={profiles} onProfilesChanged={refreshProfiles} startExpanded />
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
          autoRunOnLoad={autoStartPipeline}
          onProjectCreated={handleCreated}
        />
      )}
    </div>
  );
}
