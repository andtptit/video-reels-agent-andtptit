import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useEventStream } from "../useJobStatus.js";
import { LiveLog } from "./LiveLog.jsx";
import { TestScriptPreview } from "./TestScriptPreview.jsx";
import { ModelSelect } from "./ModelSelect.jsx";
import { EDGE_TTS_VOICES, EXPENSIVE_MODELS, CHEAP_MODELS, IMAGE_MODELS, FONT_OPTIONS } from "../lib/pipelineOptions.js";

/**
 * Standalone channel-profile editor — every field here is exactly what
 * `server/lib/profiles.mjs`'s `PROFILE_FIELDS` actually persists (plus
 * channelTheme/defaultAudience, which Batch.jsx also reads/writes on the same
 * profile object). Deliberately a SEPARATE component from Pipeline.jsx's own
 * "Cấu hình pipeline" card rather than a shared/refactored one — that card's state
 * is entangled with the real step-running functions of a live project (~20 useState
 * hooks read directly by runAllPipeline and friends); duplicating the config UI here
 * is far lower-risk than restructuring Pipeline.jsx's core state to be shared.
 *
 * Exists because profile creation used to be reachable ONLY from inside an
 * already-created project's Pipeline view — confirmed live as a real gap: there was
 * no way to set up a brand new profile before creating a (possibly throwaway) first
 * project. Rendered on the same "no project yet" screen as ProjectForm/ProjectPicker
 * (see App.jsx), collapsed by default so it doesn't clutter that screen for the
 * common case of just picking an existing profile.
 */
export function ProfileManager({ profiles, onProfilesChanged, startExpanded = false }) {
  const [expanded, setExpanded] = useState(startExpanded);

  const [selectedSlug, setSelectedSlug] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileMsg, setProfileMsg] = useState(null);

  const [ttsProvider, setTtsProvider] = useState("edge-tts");
  const [ttsRate, setTtsRate] = useState(1.1);
  const [ttsVoice, setTtsVoice] = useState("");
  const [musicTrack, setMusicTrack] = useState("");
  const [musicVolume, setMusicVolume] = useState(20);
  const [musicTracks, setMusicTracks] = useState([]);
  const [template, setTemplate] = useState("motion");
  const [visualStyle, setVisualStyle] = useState("animation");
  const [subStyle, setSubStyle] = useState("image_full_focus");
  const [photoProvider, setPhotoProvider] = useState("pexels"); // subStyle "investigation_board" only
  const [fontFamily, setFontFamily] = useState("Itim");
  const [imageStylePrefix, setImageStylePrefix] = useState("");
  const [contentPlaybook, setContentPlaybook] = useState("");
  // "Training" Content playbook — see playbook-trainer.mjs's doc comment. Scratch
  // job (like TestScriptPreview's own "test-plan"), not tied to a saved profile —
  // works fine on a brand-new, not-yet-saved profile too.
  const [trainDescription, setTrainDescription] = useState("");
  const [trainSampleScripts, setTrainSampleScripts] = useState([""]); // 1-5 mẫu, giống cap của nhánh video bên dưới
  const [trainVideos, setTrainVideos] = useState([]); // File[] — 1-5 video đối thủ
  const [trainId, setTrainId] = useState(null);
  const [training, setTraining] = useState(false);
  const [trainError, setTrainError] = useState(null);
  const [trainMsg, setTrainMsg] = useState(null);
  // Found live (user report): training successfully fills "Content playbook" but
  // only in local state — switching profile (dropdown) or "Tạo profile mới thay vì
  // sửa" silently discarded it with zero warning if the user forgot to click "Lưu
  // profile" first. Tracks exactly that one risky window; cleared on a successful
  // save (any save, not just this field, since saveCurrentAsProfile always sends
  // the full current state).
  const [playbookUnsaved, setPlaybookUnsaved] = useState(false);
  // Scratch topic just to drive "Sinh kịch bản test" below — never saved to the
  // profile itself (ProfileManager has no real "idea" field, unlike a project).
  const [testIdea, setTestIdea] = useState("");
  const [kenBurns, setKenBurns] = useState(false);
  const [grain, setGrain] = useState(false);
  const [plannerModel, setPlannerModel] = useState("");
  const [cheapModel, setCheapModel] = useState("");
  const [imgModel, setImgModel] = useState("");

  const [footageMinClips, setFootageMinClips] = useState(1);
  const [footageMaxClips, setFootageMaxClips] = useState(3);
  const [footageScenesPerClipMin, setFootageScenesPerClipMin] = useState(1);
  const [footageScenesPerClipMax, setFootageScenesPerClipMax] = useState(1);
  const [footageMinSeconds, setFootageMinSeconds] = useState(3);
  const [footageMaxSeconds, setFootageMaxSeconds] = useState(6);
  const [footageFlipEnabled, setFootageFlipEnabled] = useState(false);
  const [footageSpeedEnabled, setFootageSpeedEnabled] = useState(false);
  const [footageSpeedMin, setFootageSpeedMin] = useState(1.0);
  const [footageSpeedMax, setFootageSpeedMax] = useState(1.3);
  const [footageZoomEnabled, setFootageZoomEnabled] = useState(false);
  const [footageZoomMin, setFootageZoomMin] = useState(1.05);
  const [footageZoomMax, setFootageZoomMax] = useState(1.15);
  const [footageColorGrade, setFootageColorGrade] = useState("none");
  const [captionPosition, setCaptionPosition] = useState("bottom");
  const [footageLibraryCount, setFootageLibraryCount] = useState(null);
  // Empty = dùng kho chung assets/footage-library/ — cùng pattern "Thư mục footage
  // riêng" đã có ở tab Đọc Caption (Hook.jsx) và tab Pipeline.
  const [footageLibraryDir, setFootageLibraryDir] = useState("");
  const [footageScan, setFootageScan] = useState(null);
  const [footageScanLoading, setFootageScanLoading] = useState(false);

  const [channelTheme, setChannelTheme] = useState("");
  const [defaultAudience, setDefaultAudience] = useState("");

  const [testPromptOpen, setTestPromptOpen] = useState(false);
  const [testPromptSubject, setTestPromptSubject] = useState("");
  const [testPromptLoading, setTestPromptLoading] = useState(false);
  const [testPromptResult, setTestPromptResult] = useState(null);
  const [testPromptError, setTestPromptError] = useState(null);

  useEffect(() => {
    if (!playbookUnsaved) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [playbookUnsaved]);

  useEffect(() => {
    if (!expanded) return;
    api.listMusicLibrary().then((r) => setMusicTracks(r.tracks ?? [])).catch(() => {});
  }, [expanded]);

  useEffect(() => {
    if (!expanded || footageLibraryDir.trim()) return; // custom dir has its own "Kiểm tra thư mục" button below
    api.getFootageLibraryInfo().then((r) => setFootageLibraryCount(r.count)).catch(() => setFootageLibraryCount(null));
  }, [expanded, footageLibraryDir]);

  async function checkFootageLibraryDir(dirOverride) {
    const dir = (dirOverride ?? footageLibraryDir).trim();
    if (!dir) {
      setFootageScan(null);
      return;
    }
    setFootageScanLoading(true);
    try {
      const r = await api.scanFootageFolder(dir);
      setFootageScan(r);
    } catch (err) {
      setFootageScan({ count: 0, images: 0, videos: 0, error: err.message });
    } finally {
      setFootageScanLoading(false);
    }
  }

  const [pexelsQuery, setPexelsQuery] = useState("");
  const [pexelsCount, setPexelsCount] = useState(5); // per keyword — vd 8 keyword × 5 = tới 40 clip
  const [pexelsLoading, setPexelsLoading] = useState(false);
  const [pexelsResult, setPexelsResult] = useState(null);
  const [keywordLoading, setKeywordLoading] = useState(false);

  async function suggestKeyword() {
    setKeywordLoading(true);
    setPexelsResult(null);
    try {
      const r = await api.suggestFootageKeyword({ channelTheme, contentPlaybook });
      setPexelsQuery(r.keywords.join(", "));
    } catch (err) {
      setPexelsResult({ error: err.message });
    } finally {
      setKeywordLoading(false);
    }
  }

  // Đây là nơi setup CHÍNH cho profile (không phải Pipeline.jsx) — nên sau khi tải
  // xong, tự điền luôn "Thư mục footage" nếu đang trống, thay vì bắt user tự gõ tay
  // đường dẫn vừa tải vào. Vẫn cần bấm "Lưu profile" ở trên để thực sự lưu lại, cùng
  // quy ước với mọi field khác trong form này (không âm thầm ghi đè profile).
  function slugifyFolderName(text) {
    return (text || "kenh")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "").slice(0, 40) || "kenh";
  }

  const pexelsAbortRef = useRef(null);

  async function fetchPexelsFootage() {
    if (!pexelsQuery.trim()) return;
    setPexelsLoading(true);
    setPexelsResult(null);
    const controller = new AbortController();
    pexelsAbortRef.current = controller;
    try {
      const dir = footageLibraryDir.trim() || `assets/footage-library/${slugifyFolderName(profileName || channelTheme)}`;
      const keywords = pexelsQuery.split(",").map((k) => k.trim()).filter(Boolean);
      const r = await api.fetchPexelsFootage({ query: keywords, dir, format: "9:16", count: Number(pexelsCount) || 20 }, controller.signal);
      setPexelsResult({ ...r, done: true });
      if (!footageLibraryDir.trim()) setFootageLibraryDir(dir);
      await checkFootageLibraryDir(dir);
    } catch (err) {
      if (err.name === "AbortError") setPexelsResult({ stopped: true });
      else setPexelsResult({ error: err.message });
    } finally {
      setPexelsLoading(false);
      pexelsAbortRef.current = null;
    }
  }

  function stopPexelsFetch() {
    pexelsAbortRef.current?.abort();
  }

  function applyProfile(p) {
    if (!p) return;
    if (p.ttsProvider !== undefined) setTtsProvider(p.ttsProvider);
    if (p.ttsRate !== undefined) setTtsRate(p.ttsRate);
    if (p.ttsVoice !== undefined) setTtsVoice(p.ttsVoice);
    if (p.musicTrack !== undefined) setMusicTrack(p.musicTrack);
    if (p.musicVolume !== undefined) setMusicVolume(p.musicVolume);
    if (p.template !== undefined) setTemplate(p.template);
    if (p.visualStyle !== undefined) setVisualStyle(p.visualStyle);
    if (p.subStyle !== undefined) setSubStyle(p.subStyle);
    if (p.photoProvider !== undefined) setPhotoProvider(p.photoProvider);
    if (p.fontFamily !== undefined) setFontFamily(p.fontFamily);
    if (p.imageStylePrefix !== undefined) setImageStylePrefix(p.imageStylePrefix);
    if (p.contentPlaybook !== undefined) setContentPlaybook(p.contentPlaybook);
    if (p.kenBurns !== undefined) setKenBurns(p.kenBurns);
    if (p.grain !== undefined) setGrain(p.grain);
    if (p.plannerModel !== undefined) setPlannerModel(p.plannerModel);
    if (p.cheapModel !== undefined) setCheapModel(p.cheapModel);
    if (p.imgModel !== undefined) setImgModel(p.imgModel);
    if (p.footageLibraryDir !== undefined) setFootageLibraryDir(p.footageLibraryDir);
    if (p.footageMinClips !== undefined) setFootageMinClips(p.footageMinClips);
    if (p.footageMaxClips !== undefined) setFootageMaxClips(p.footageMaxClips);
    if (p.footageScenesPerClipMin !== undefined) setFootageScenesPerClipMin(p.footageScenesPerClipMin);
    if (p.footageScenesPerClipMax !== undefined) setFootageScenesPerClipMax(p.footageScenesPerClipMax);
    if (p.footageMinSeconds !== undefined) setFootageMinSeconds(p.footageMinSeconds);
    if (p.footageMaxSeconds !== undefined) setFootageMaxSeconds(p.footageMaxSeconds);
    if (p.footageFlipEnabled !== undefined) setFootageFlipEnabled(p.footageFlipEnabled);
    if (p.footageSpeedEnabled !== undefined) setFootageSpeedEnabled(p.footageSpeedEnabled);
    if (p.footageSpeedMin !== undefined) setFootageSpeedMin(p.footageSpeedMin);
    if (p.footageSpeedMax !== undefined) setFootageSpeedMax(p.footageSpeedMax);
    if (p.footageZoomEnabled !== undefined) setFootageZoomEnabled(p.footageZoomEnabled);
    if (p.footageZoomMin !== undefined) setFootageZoomMin(p.footageZoomMin);
    if (p.footageZoomMax !== undefined) setFootageZoomMax(p.footageZoomMax);
    if (p.footageColorGrade !== undefined) setFootageColorGrade(p.footageColorGrade);
    if (p.captionPosition !== undefined) setCaptionPosition(p.captionPosition);
    if (p.channelTheme !== undefined) setChannelTheme(p.channelTheme);
    if (p.defaultAudience !== undefined) setDefaultAudience(p.defaultAudience);
  }

  function confirmDiscardUnsavedPlaybook() {
    if (!playbookUnsaved) return true;
    return window.confirm(
      'Content playbook vừa train CHƯA được lưu — chuyển/tạo profile khác sẽ MẤT nội dung này. Vẫn tiếp tục?'
    );
  }

  function onSelectProfile(slug) {
    if (!confirmDiscardUnsavedPlaybook()) return;
    setPlaybookUnsaved(false);
    setSelectedSlug(slug);
    setProfileMsg(null);
    const p = profiles.find((x) => x.slug === slug);
    if (p) {
      applyProfile(p);
      setProfileName(p.name);
    }
  }

  function startNewProfile() {
    if (!confirmDiscardUnsavedPlaybook()) return;
    setPlaybookUnsaved(false);
    setSelectedSlug("");
    setProfileName("");
    setProfileMsg(null);
  }

  async function saveCurrentAsProfile() {
    setProfileMsg(null);
    if (!profileName.trim()) {
      setProfileMsg({ ok: false, text: "Nhập tên profile trước đã." });
      return;
    }
    try {
      const saved = await api.saveProfile(profileName, {
        ttsProvider, ttsRate, ttsVoice, musicTrack, musicVolume, template, visualStyle, subStyle, photoProvider, fontFamily,
        imageStylePrefix, contentPlaybook, kenBurns, grain, plannerModel, cheapModel, imgModel,
        footageLibraryDir: footageLibraryDir.trim() || undefined,
        footageMinClips, footageMaxClips, footageScenesPerClipMin, footageScenesPerClipMax,
        footageMinSeconds, footageMaxSeconds,
        footageFlipEnabled, footageSpeedEnabled, footageSpeedMin, footageSpeedMax,
        footageZoomEnabled, footageZoomMin, footageZoomMax, footageColorGrade, captionPosition,
        channelTheme, defaultAudience,
      });
      setSelectedSlug(saved.slug);
      setPlaybookUnsaved(false);
      setProfileMsg({ ok: true, text: `Đã lưu profile "${saved.name}".` });
      onProfilesChanged?.();
    } catch (err) {
      setProfileMsg({ ok: false, text: err.message });
    }
  }

  async function deleteCurrentProfile() {
    if (!selectedSlug) return;
    const name = profiles.find((p) => p.slug === selectedSlug)?.name ?? selectedSlug;
    if (!window.confirm(`Xoá profile "${name}"? Không thể hoàn tác.`)) return;
    setProfileMsg(null);
    try {
      await api.deleteProfile(selectedSlug);
      startNewProfile();
      setProfileMsg({ ok: true, text: `Đã xoá profile "${name}".` });
      onProfilesChanged?.();
    } catch (err) {
      setProfileMsg({ ok: false, text: err.message });
    }
  }

  const { steps: trainSteps, events: trainEvents } = useEventStream(trainId ? api.batchEventsUrl(trainId) : null);
  const trainStatus = trainSteps["train-playbook"]?.status;

  // Fetches the final playbook once the step settles — SSE only carries live
  // events, not the written file itself (same pattern as TestScriptPreview.jsx).
  useEffect(() => {
    if (!trainId || !training || (trainStatus !== "done" && trainStatus !== "error")) return;
    if (trainStatus === "error") {
      setTrainError(trainSteps["train-playbook"]?.error ?? "Lỗi không rõ");
      setTraining(false);
      return;
    }
    api
      .getTrainPlaybookResult(trainId)
      .then((r) => {
        if (r.playbook) {
          setContentPlaybook(r.playbook);
          setPlaybookUnsaved(true);
          setTrainMsg('Đã cập nhật "Content playbook" bên trên — xem lại rồi bấm "Lưu profile" để giữ.');
        } else {
          setTrainError("Không nhận được playbook từ kết quả training.");
        }
      })
      .catch((err) => setTrainError(err.message))
      .finally(() => setTraining(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainId, training, trainStatus]);

  const trainSampleScriptsFilled = trainSampleScripts.filter((s) => s.trim());

  async function runTraining() {
    setTrainError(null);
    setTrainMsg(null);
    if (!trainSampleScriptsFilled.length) {
      setTrainError("Cần dán ít nhất 1 kịch bản mẫu trước.");
      return;
    }
    setTraining(true);
    try {
      const { trainId: id } = await api.trainPlaybook({
        description: trainDescription.trim() || undefined,
        sampleScripts: trainSampleScriptsFilled,
        existingPlaybook: contentPlaybook.trim() || undefined,
      });
      setTrainId(id);
    } catch (err) {
      setTrainError(err.message);
      setTraining(false);
    }
  }

  // "3-5 video đối thủ" — mỗi file tự transcribe qua Whisper server-side (nhận thẳng
  // video, không cần tách audio tay), rồi gộp vào cùng luồng phân tích/áp dụng như
  // runTraining ở trên (cùng trainId/polling/useEffect, chỉ khác cách kích hoạt).
  async function runTrainingFromVideos() {
    setTrainError(null);
    setTrainMsg(null);
    if (!trainVideos.length) {
      setTrainError("Cần chọn ít nhất 1 file video trước.");
      return;
    }
    setTraining(true);
    try {
      const { trainId: id } = await api.trainPlaybookFromVideos(trainVideos, {
        description: trainDescription.trim() || undefined,
        existingPlaybook: contentPlaybook.trim() || undefined,
      });
      setTrainId(id);
    } catch (err) {
      setTrainError(err.message);
      setTraining(false);
    }
  }

  if (!expanded) {
    return (
      <button type="button" className="linklike" onClick={() => setExpanded(true)}>
        + Quản lý profile kênh
      </button>
    );
  }

  const needsImageStyle = (template === "sub" && subStyle !== "kinetic_typography") || visualStyle === "ai-image";

  return (
    <div className="card">
      <div className="step-row-head">
        <h3>Quản lý profile kênh</h3>
        <button type="button" className="linklike" onClick={() => setExpanded(false)}>Thu gọn</button>
      </div>
      <p className="muted">
        Tạo/sửa preset TTS, template, phong cách ảnh AI, cấu hình footage — dùng lại khi tạo project mới, không cần
        có project nào đang mở.
      </p>

      <div className="inline-form">
        <select value={selectedSlug} onChange={(e) => onSelectProfile(e.target.value)} title="Load profile đã lưu để sửa">
          <option value="">— Chọn profile để sửa (hoặc để trống để tạo mới) —</option>
          {profiles.map((p) => (
            <option key={p.slug} value={p.slug}>{p.name}</option>
          ))}
        </select>
        {selectedSlug && (
          <button type="button" className="linklike" onClick={startNewProfile}>Tạo profile mới thay vì sửa</button>
        )}
      </div>

      <div className="inline-form">
        <input
          placeholder="Tên profile (vd: Mẹ và bé)"
          value={profileName}
          onChange={(e) => setProfileName(e.target.value)}
          style={{ minWidth: "200px" }}
        />
        <button type="button" onClick={saveCurrentAsProfile}>
          {selectedSlug ? "Cập nhật profile" : "Lưu thành profile mới"}
        </button>
        {selectedSlug && (
          <button type="button" className="linklike" onClick={deleteCurrentProfile}>Xoá profile</button>
        )}
      </div>
      {profileMsg && <p className={profileMsg.ok ? "muted" : "error"}>{profileMsg.text}</p>}

      <p className="muted" style={{ marginTop: "12px" }}>Chủ đề kênh (dùng để LLM tự sinh ý tưởng)</p>
      <div className="inline-form">
        <textarea
          value={channelTheme}
          onChange={(e) => setChannelTheme(e.target.value)}
          placeholder="Chủ đề kênh — vd: mẹ và bé, khoảnh khắc yêu thương thường ngày"
          rows={2}
        />
        <input
          value={defaultAudience}
          onChange={(e) => setDefaultAudience(e.target.value)}
          placeholder="Đối tượng xem mặc định — vd: các bà mẹ trẻ có con nhỏ"
        />
      </div>

      <p className="muted" style={{ marginTop: "12px" }}>
        Content playbook — định hướng nội dung riêng của kênh (nhân vật, giọng kể, điều nên/không nên). Áp dụng cho cả
        sinh ý tưởng (tab Hàng loạt) lẫn viết kịch bản thật — quan trọng hơn mọi hướng dẫn chung.
      </p>
      <div className="inline-form">
        <textarea
          value={contentPlaybook}
          onChange={(e) => setContentPlaybook(e.target.value)}
          placeholder={
            'Vd: Storytelling qua nhân vật "Lan Thoa", phụ nữ trung niên giữ chồng — kể chuyện đời thường, sexy nhẹ ' +
            "nhàng vừa đủ, tinh tế không thô. KHÔNG viết dạng liệt kê mẹo/tips."
          }
          rows={3}
        />
      </div>

      <div className="card" style={{ marginTop: "8px" }}>
        <p className="muted">
          <strong>Training Content playbook</strong> — mô tả ý muốn + dán 1-5 kịch bản mẫu bạn ưng ý, AI tự trích ra
          giọng văn/quy tắc rồi điền lại ô "Content playbook" ở trên (chưa lưu — bạn xem lại rồi bấm "Lưu profile").
          Dán từ 2 mẫu trở lên: AI chỉ giữ pattern LẶP LẠI xuyên suốt, bỏ qua cái chỉ xuất hiện đúng 1 mẫu (nhiều khả
          năng là ngẫu nhiên, không phải công thức thật). Train nhiều lần sẽ tự bổ sung dần vào playbook cũ, không
          ghi đè trắng.
        </p>
        <textarea
          value={trainDescription}
          onChange={(e) => setTrainDescription(e.target.value)}
          placeholder="Mô tả ý muốn (tuỳ chọn) — vd: xưng hô mày/tao, giọng thẳng thắn khiêu khích, nhắm vào đàn ông..."
          rows={2}
          disabled={training}
        />
        {trainSampleScripts.map((script, i) => (
          <div key={i} style={{ position: "relative" }}>
            <textarea
              value={script}
              onChange={(e) =>
                setTrainSampleScripts((prev) => prev.map((s, idx) => (idx === i ? e.target.value : s)))
              }
              placeholder={`Dán kịch bản mẫu #${i + 1} bạn ưng ý vào đây...`}
              rows={8}
              disabled={training}
            />
            {trainSampleScripts.length > 1 && (
              <button
                type="button"
                className="linklike"
                disabled={training}
                onClick={() => setTrainSampleScripts((prev) => prev.filter((_, idx) => idx !== i))}
              >
                Xoá mẫu #{i + 1}
              </button>
            )}
          </div>
        ))}
        {trainSampleScripts.length < 5 && (
          <button
            type="button"
            className="linklike"
            disabled={training}
            onClick={() => setTrainSampleScripts((prev) => [...prev, ""])}
          >
            + Thêm kịch bản mẫu ({trainSampleScripts.length}/5)
          </button>
        )}
        <button type="button" onClick={runTraining} disabled={training || !trainSampleScriptsFilled.length}>
          {training ? "Đang train..." : `Train playbook (từ ${trainSampleScriptsFilled.length || ""} text)`}
        </button>

        <p className="muted" style={{ marginTop: "8px" }}>
          Hoặc train từ 1-5 video đối thủ (vd Reels viral) — mỗi video được tự phiên âm (Whisper) rồi phân tích chung
          để tìm pattern LẶP LẠI xuyên suốt (bỏ qua cái chỉ xuất hiện ở 1 video, vì nhiều khả năng là ngẫu nhiên).
        </p>
        <input
          type="file"
          accept="video/*"
          multiple
          onChange={(e) => setTrainVideos(Array.from(e.target.files ?? []).slice(0, 5))}
          disabled={training}
        />
        {trainVideos.length > 0 && <p className="muted">{trainVideos.length} video đã chọn: {trainVideos.map((f) => f.name).join(", ")}</p>}
        <button type="button" onClick={runTrainingFromVideos} disabled={training || !trainVideos.length}>
          {training ? "Đang train..." : `Train playbook (từ ${trainVideos.length || ""} video)`}
        </button>

        {trainError && <p className="error">{trainError}</p>}
        {trainMsg && <p className="muted">{trainMsg}</p>}
        {training && <LiveLog events={trainEvents} step="train-playbook" maxLines={8} />}
      </div>

      <div className="inline-form" style={{ marginTop: "8px" }}>
        <input
          value={testIdea}
          onChange={(e) => setTestIdea(e.target.value)}
          placeholder="Chủ đề thử nghiệm (chỉ để test, không lưu vào profile) — vd: 3 sai lầm khi..."
          style={{ minWidth: "320px" }}
        />
      </div>
      <TestScriptPreview
        kind="content-planner"
        getParams={() => ({
          idea: testIdea,
          audience: defaultAudience || undefined,
          platform: "9:16",
          targetDuration: "30–60s",
          // Live, not-yet-saved playbook — bypasses the profileSlug lookup so you
          // can test edits before hitting "Lưu profile" (see routes.mjs's
          // /test-content-plan contentPlaybook override).
          contentPlaybook: contentPlaybook.trim() || undefined,
          model: plannerModel || undefined,
        })}
      />

      <p className="muted" style={{ marginTop: "12px" }}>Audio (TTS)</p>
      <div className="inline-form">
        <select value={ttsProvider} onChange={(e) => setTtsProvider(e.target.value)}>
          <option value="edge-tts">edge-tts (free)</option>
          <option value="elevenlabs">elevenlabs</option>
          <option value="vbee">vbee</option>
        </select>
        {ttsProvider === "edge-tts" && (
          <>
            <select value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)} title="Giọng đọc edge-tts">
              {EDGE_TTS_VOICES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <input
              type="number" step="0.1" min="0.5" max="2" title="Tốc độ đọc (1.0 = bình thường)"
              value={ttsRate} onChange={(e) => setTtsRate(Number(e.target.value))} style={{ width: "70px" }}
            />
          </>
        )}
        {ttsProvider === "vbee" && (
          <>
            <input
              placeholder="Mã giọng Vbee (để trống = dùng VBEE_VOICE_CODE trong .env)"
              value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)}
              title="Vd: hn_female_ngochuyen_full_48k-fhg — lấy qua API 'Get list voices' hoặc studio.vbee.vn"
              style={{ minWidth: "300px" }}
            />
            <input
              type="number" step="0.1" min="0.25" max="1.9" title="Tốc độ đọc (1.0 = bình thường, 0.25-1.9)"
              value={ttsRate} onChange={(e) => setTtsRate(Number(e.target.value))} style={{ width: "70px" }}
            />
          </>
        )}
      </div>
      <div className="inline-form">
        <select value={musicTrack} onChange={(e) => setMusicTrack(e.target.value)} title="Nhạc nền">
          <option value="">Tự động theo mood ({musicTracks.includes("default") ? "dự phòng: default" : "chưa có thư viện"})</option>
          {musicTracks.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          type="number" min="0" max="100" title="Âm lượng nhạc nền (% so với voice)"
          value={musicVolume} onChange={(e) => setMusicVolume(Number(e.target.value))} style={{ width: "70px" }}
        />
        <span className="muted">% âm lượng nền</span>
      </div>

      <p className="muted" style={{ marginTop: "12px" }}>Video plan — template, style, model</p>
      <div className="inline-form">
        <select value={template} onChange={(e) => setTemplate(e.target.value)}>
          <option value="motion">Chuyển động (card/animation)</option>
          <option value="sub">Sub karaoke (ảnh AI + phụ đề chạy chữ)</option>
          <option value="footage">Footage (video thật ghép ngẫu nhiên + sub)</option>
        </select>
        {template === "motion" ? (
          <select value={visualStyle} onChange={(e) => setVisualStyle(e.target.value)}>
            <option value="animation">Nền CSS/GSAP thuần</option>
            <option value="ai-image">Nền ảnh AI (wan2.6-image)</option>
          </select>
        ) : template === "footage" ? (
          <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} title="Font phụ đề">
            {FONT_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        ) : (
          <>
            <select value={subStyle} onChange={(e) => setSubStyle(e.target.value)}>
              <option value="image_full_focus">Full Focus (ảnh full-bleed + sub đáy)</option>
              <option value="image_blur_card">Blur Card (ảnh vuông nổi bật + nền mờ cùng ảnh)</option>
              <option value="image_life_insights_light">Life Insights Light (ảnh vuông + nền kem hoạ tiết)</option>
              <option value="investigation_board">Bảng điều tra (ảnh thật + giấy cũ + băng dán)</option>
            </select>
            {subStyle === "investigation_board" && (
              <select value={photoProvider} onChange={(e) => setPhotoProvider(e.target.value)} title="Nguồn ảnh thật cho style Bảng điều tra">
                <option value="pexels">Pexels (kho ảnh stock, rộng hơn)</option>
                <option value="openverse">Openverse (Wikimedia/Flickr, chỉ CC0/Public Domain, sát chủ đề thật hơn)</option>
              </select>
            )}
            <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} title="Font phụ đề">
              {FONT_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </>
        )}

        {template === "footage" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span>Thư mục footage:</span>
              <input
                value={footageLibraryDir}
                onChange={(e) => { setFootageLibraryDir(e.target.value); setFootageScan(null); }}
                placeholder="để trống = dùng kho chung assets/footage-library/. Vd: assets/footage-library/xyz hoặc đường dẫn tuyệt đối"
                title="Đường dẫn tương đối tính từ gốc thư mục project, hoặc đường dẫn tuyệt đối đầy đủ — lưu theo profile"
                style={{ minWidth: "380px" }}
              />
              {footageLibraryDir.trim() && (
                <button type="button" className="linklike" disabled={footageScanLoading} onClick={() => checkFootageLibraryDir()}>
                  {footageScanLoading ? "Đang kiểm tra…" : "Kiểm tra thư mục"}
                </button>
              )}
            </div>
            <p className="muted">
              {footageLibraryDir.trim() ? (
                footageScan == null ? (
                  "bấm \"Kiểm tra thư mục\" để xem số file"
                ) : footageScan.error ? (
                  <span className="error">{footageScan.error}</span>
                ) : (
                  `${footageScan.videos ?? footageScan.count} video${footageScan.images ? `, ${footageScan.images} ảnh` : ""} trong thư mục này`
                )
              ) : (
                <>
                  Kho footage: {footageLibraryCount === null ? "đang kiểm tra..." : `${footageLibraryCount} video`}
                  {footageLibraryCount === 0 && " — chưa có file .mp4 nào trong assets/footage-library/"}
                </>
              )}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span>Tải footage từ Pexels:</span>
              <input
                value={pexelsQuery}
                onChange={(e) => setPexelsQuery(e.target.value)}
                placeholder="các từ khoá tiếng Anh NGẮN, cách nhau bởi dấu phẩy — vd: gym, running, discipline, hard work"
                style={{ minWidth: "320px" }}
              />
              <button type="button" className="linklike" disabled={keywordLoading} onClick={suggestKeyword} title="LLM đọc chủ đề kênh + content playbook để tự gợi ý 5-10 từ khoá ngắn">
                {keywordLoading ? "Đang tìm…" : "LLM tìm keyword"}
              </button>
              <input type="number" min="1" max="30" value={pexelsCount} onChange={(e) => setPexelsCount(e.target.value)} style={{ width: "60px" }} title="Số clip tải MỖI từ khoá" />
              <span className="muted">clip/từ khoá</span>
              {pexelsLoading ? (
                <button type="button" onClick={stopPexelsFetch}>Dừng</button>
              ) : (
                <button type="button" className="linklike" disabled={!pexelsQuery.trim()} onClick={fetchPexelsFootage}>
                  Tải từ Pexels
                </button>
              )}
            </div>
            {pexelsLoading && <p className="muted">Đang tải…</p>}
            {pexelsResult && (
              <p className={pexelsResult.error ? "error" : "muted"}>
                {pexelsResult.error
                  ? pexelsResult.error
                  : pexelsResult.stopped
                    ? "Đã dừng — một số clip có thể đã kịp tải trước khi dừng."
                    : `Xong! ${pexelsResult.byKeyword?.length ?? 1} từ khoá — tìm thấy ${pexelsResult.found} clip, tải mới ${pexelsResult.downloaded}, đã có sẵn ${pexelsResult.skipped}${pexelsResult.errors?.length ? `, lỗi ${pexelsResult.errors.length}` : ""}. Đã tự điền "Thư mục footage" ở trên — nhớ bấm "Lưu profile" để giữ lại.`}
              </p>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span>Số clip/scene:</span>
              <input type="number" min="1" value={footageMinClips} onChange={(e) => setFootageMinClips(e.target.value)} style={{ width: "60px" }} />
              <span>–</span>
              <input type="number" min="1" value={footageMaxClips} onChange={(e) => setFootageMaxClips(e.target.value)} style={{ width: "60px" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span title="Số scene liên tiếp dùng chung 1 clip/ảnh trước khi đổi sang cái khác — để 1-1 = mỗi scene tự đổi clip riêng">Số scene / 1 clip:</span>
              <input type="number" min="1" value={footageScenesPerClipMin} onChange={(e) => setFootageScenesPerClipMin(e.target.value)} style={{ width: "60px" }} />
              <span>–</span>
              <input type="number" min="1" value={footageScenesPerClipMax} onChange={(e) => setFootageScenesPerClipMax(e.target.value)} style={{ width: "60px" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span>Độ dài mỗi đoạn (giây):</span>
              <input type="number" min="0.5" step="0.5" value={footageMinSeconds} onChange={(e) => setFootageMinSeconds(e.target.value)} style={{ width: "60px" }} />
              <span>–</span>
              <input type="number" min="0.5" step="0.5" value={footageMaxSeconds} onChange={(e) => setFootageMaxSeconds(e.target.value)} style={{ width: "60px" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input type="checkbox" checked={footageFlipEnabled} onChange={(e) => setFootageFlipEnabled(e.target.checked)} style={{ width: "auto", marginBottom: 0 }} />
                Lật ngẫu nhiên (tránh trùng lặp footage)
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input type="checkbox" checked={footageSpeedEnabled} onChange={(e) => setFootageSpeedEnabled(e.target.checked)} style={{ width: "auto", marginBottom: 0 }} />
                Tăng tốc ngẫu nhiên
              </label>
              {footageSpeedEnabled && (
                <>
                  <input type="number" min="1" step="0.1" value={footageSpeedMin} onChange={(e) => setFootageSpeedMin(e.target.value)} style={{ width: "60px" }} />
                  <span>–</span>
                  <input type="number" min="1" step="0.1" value={footageSpeedMax} onChange={(e) => setFootageSpeedMax(e.target.value)} style={{ width: "60px" }} />
                  <span>x</span>
                </>
              )}
              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input type="checkbox" checked={footageZoomEnabled} onChange={(e) => setFootageZoomEnabled(e.target.checked)} style={{ width: "auto", marginBottom: 0 }} />
                Zoom ngẫu nhiên (in/out, cả ảnh lẫn video)
              </label>
              {footageZoomEnabled && (
                <>
                  <input type="number" min="1.01" step="0.01" value={footageZoomMin} onChange={(e) => setFootageZoomMin(e.target.value)} style={{ width: "60px" }} />
                  <span>–</span>
                  <input type="number" min="1.01" step="0.01" value={footageZoomMax} onChange={(e) => setFootageZoomMax(e.target.value)} style={{ width: "60px" }} />
                  <span>x</span>
                </>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span>Màu sắc:</span>
              <select value={footageColorGrade} onChange={(e) => setFootageColorGrade(e.target.value)} title="Lớp phủ màu cho footage — hợp vibe nghiêm túc/kỷ luật">
                <option value="none">Không</option>
                <option value="dark">Tối nhẹ</option>
                <option value="dark-dramatic">Tối kịch tính</option>
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span>Vị trí sub:</span>
              <select value={captionPosition} onChange={(e) => setCaptionPosition(e.target.value)} title="Vị trí phụ đề — giữa màn hình chữ to hơn, tối đa 3 từ/khung hình">
                <option value="bottom">Dưới đáy (mặc định)</option>
                <option value="center">Giữa màn hình (chữ to, tối đa 3 từ)</option>
              </select>
            </div>
          </div>
        )}

        {needsImageStyle && (
          <>
            <textarea
              placeholder='Phong cách ảnh AI (để trống = "minimalist matchstick figure") — vd chủ thể, chất liệu, tông màu...'
              value={imageStylePrefix} onChange={(e) => setImageStylePrefix(e.target.value)}
              rows={2}
            />
            <button type="button" className="linklike" onClick={() => setTestPromptOpen((v) => !v)}>
              {testPromptOpen ? "Ẩn test prompt" : "Test prompt (thử phong cách trước khi dùng)"}
            </button>
            {testPromptOpen && (
              <div className="inline-form" style={{ alignItems: "flex-start" }}>
                <input
                  value={testPromptSubject}
                  onChange={(e) => setTestPromptSubject(e.target.value)}
                  placeholder='Chủ thể chính — vd: "mẹ bế con nhỏ trên giường"'
                />
                <button
                  type="button"
                  disabled={!testPromptSubject.trim() || testPromptLoading}
                  onClick={() => {
                    setTestPromptLoading(true);
                    setTestPromptError(null);
                    setTestPromptResult(null);
                    api
                      .testImage({ prompt: testPromptSubject, imageStylePrefix: imageStylePrefix.trim() || undefined, model: imgModel || undefined })
                      .then(setTestPromptResult)
                      .catch((err) => setTestPromptError(err.message))
                      .finally(() => setTestPromptLoading(false));
                  }}
                >
                  {testPromptLoading ? "Đang sinh ảnh..." : "Sinh ảnh test"}
                </button>
                {testPromptError && <p className="error">{testPromptError}</p>}
                {testPromptResult && (
                  <div style={{ width: "100%" }}>
                    <img src={testPromptResult.imageUrl} alt="test prompt result" style={{ maxWidth: "280px", borderRadius: "8px", display: "block" }} />
                    <p className="muted" style={{ wordBreak: "break-word" }}>{testPromptResult.fullPrompt}</p>
                    <p className="muted">Link ảnh hết hạn sau 24h — không tự lưu, chỉ để xem thử.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {template === "sub" && subStyle !== "kinetic_typography" && (
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <span>Effect:</span>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <input type="checkbox" checked={kenBurns} onChange={(e) => setKenBurns(e.target.checked)} style={{ width: "auto", marginBottom: 0 }} />
              Ken Burns (zoom nhẹ ảnh nền 1 → 1.1)
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <input type="checkbox" checked={grain} onChange={(e) => setGrain(e.target.checked)} style={{ width: "auto", marginBottom: 0 }} />
              Vết xước nhẹ (film grain)
            </label>
          </div>
        )}

        <ModelSelect value={plannerModel} onChange={setPlannerModel} options={EXPENSIVE_MODELS} title="Model (đắt) cho content-planner + video-planner" />
        <ModelSelect value={cheapModel} onChange={setCheapModel} options={CHEAP_MODELS} title="Model (rẻ) cho scene-writer + ghép video" />
        {needsImageStyle && (
          <ModelSelect value={imgModel} onChange={setImgModel} options={IMAGE_MODELS} title="Model sinh ảnh AI" />
        )}
      </div>
    </div>
  );
}
