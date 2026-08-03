import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useJobStatus } from "../useJobStatus.js";
import { StatusBadge } from "./StatusBadge.jsx";
import { TokenBadge } from "./TokenBadge.jsx";
import { CheckpointPanel } from "./CheckpointPanel.jsx";
import { SceneGrid } from "./SceneGrid.jsx";
import { LiveLog } from "./LiveLog.jsx";
import { PreviewFrame } from "./PreviewFrame.jsx";
import { RenderPlayer } from "./RenderPlayer.jsx";

// Chỉ liệt kê model đã xác nhận hoạt động thật (gọi thử tool_calls/image-gen thật) —
// đã loại: qwen-vl-ocr (cần ảnh đầu vào, không phải model chat), qwen-mt-flash
// (không hỗ trợ tool_calls, chỉ dịch), wan2.1-kf2v-plus/wan2.7-i2v/wan2.6-t2v (model
// SINH VIDEO, không tương thích endpoint sinh ảnh tĩnh hiện tại — cần tích hợp riêng).
// vi-VN-HoaiMyNeural (nữ, mặc định cũ) + vi-VN-NamMinhNeural (nam) — cả 2 đều là
// giọng Azure Neural miễn phí qua edge-tts, giữ cả 2 để chọn thay vì thay hẳn giọng
// cũ (user muốn nghe thử giọng nam nhưng không muốn mất lựa chọn giọng nữ).
const EDGE_TTS_VOICES = [
  ["vi-VN-HoaiMyNeural", "HoaiMy (nữ) — mặc định"],
  ["vi-VN-NamMinhNeural", "NamMinh (nam)"],
];

const EXPENSIVE_MODELS = ["qwen3.5-plus", "qwen-plus-2025-04-28"];
const CHEAP_MODELS = ["qwen3.6-flash", "qwen-flash", "deepseek-v4-flash", "qwen3-vl-flash"];
const IMAGE_MODELS = ["wan2.6-image", "qwen-image", "qwen-image-2.0", "z-image-turbo"];

function ModelSelect({ value, onChange, options, title }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title={title}>
      <option value="">Model mặc định (.env)</option>
      {options.map((m) => (
        <option key={m} value={m}>{m}</option>
      ))}
    </select>
  );
}

const NAV_DOT_COLOR = { running: "#d68a10", done: "#1a8f4c", error: "#c62828" };

/** Sticky quick-nav so a long project page (config + 5 steps + up to N scene cards +
 *  live logs + remix) doesn't require scrolling back up manually to jump between
 *  sections — each link also carries a status dot so you can see at a glance which
 *  steps are done/running/errored without scrolling to them first. */
function PipelineNav({ items }) {
  function jump(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return (
    <nav className="pipeline-nav">
      {items.filter((it) => it.show !== false).map((it) => (
        <button key={it.id} type="button" onClick={() => jump(it.id)}>
          {it.status && (
            <span className="pipeline-nav-dot" style={{ background: NAV_DOT_COLOR[it.status] ?? "#888" }} />
          )}
          {it.label}
        </button>
      ))}
    </nav>
  );
}

function StepRow({ id, title, status, error, usage, children }) {
  return (
    <div className="step-row" id={id}>
      <div className="step-row-head">
        <strong>{title}</strong>
        <span className="step-row-badges">
          <TokenBadge usage={usage} />
          <StatusBadge status={status} />
        </span>
      </div>
      {children}
      {status === "error" && error && <p className="error">{error}</p>}
    </div>
  );
}

const FONT_OPTIONS = [
  ["Itim", "Itim (viết tay, tròn)"],
  ["Mali", "Mali (viết tay, nhiều độ đậm)"],
  ["Pacifico", "Pacifico (script mềm mại)"],
  ["Charm", "Charm (thư pháp, thanh)"],
  ["Sriracha", "Sriracha (bút lông, khoẻ)"],
  ["Amatic SC", "Amatic SC (marker, cô đặc)"],
];

export function Pipeline({ id, idea, platform, initialProfileSlug, onProjectCreated }) {
  const { steps, totalUsage, events } = useJobStatus(id);
  const [audience, setAudience] = useState("");
  const [ttsProvider, setTtsProvider] = useState("edge-tts");
  const [ttsRate, setTtsRate] = useState(1.1);
  const [ttsVoice, setTtsVoice] = useState("");
  const [musicTrack, setMusicTrack] = useState("");
  const [musicVolume, setMusicVolume] = useState(20);
  const [musicTracks, setMusicTracks] = useState([]);
  const [template, setTemplate] = useState("motion");
  const [visualStyle, setVisualStyle] = useState("animation");
  const [subStyle, setSubStyle] = useState("image_full_focus");
  const [imageStylePrefix, setImageStylePrefix] = useState("");
  // "Test prompt" — quick standalone image-gen call to tune imageStylePrefix/model
  // before spending a full pipeline run on it (tham khảo Pixelle-Video). Hidden by
  // default, toggled open on demand.
  const [testPromptOpen, setTestPromptOpen] = useState(false);
  const [testPromptSubject, setTestPromptSubject] = useState("");
  const [testPromptResult, setTestPromptResult] = useState(null);
  const [testPromptLoading, setTestPromptLoading] = useState(false);
  const [testPromptError, setTestPromptError] = useState(null);
  const [fontFamily, setFontFamily] = useState("Itim");
  const [plannerModel, setPlannerModel] = useState("");
  const [cheapModel, setCheapModel] = useState("");
  const [imgModel, setImgModel] = useState("");
  // Image-library reuse — chỉ có tác dụng khi có chọn profile kênh (selectedProfileSlug),
  // xem lib/image-library.mjs. maxReuse để trống = không giới hạn số scene tái dùng.
  const [imageLibraryEnabled, setImageLibraryEnabled] = useState(false);
  const [imageLibraryMaxReuse, setImageLibraryMaxReuse] = useState("");
  // Ken Burns zoom-out effect (1 -> 1.1) trên ảnh nền mỗi scene — chỉ áp dụng cho
  // style "sub". Mặc định KHÔNG áp dụng, phải bật tay.
  const [kenBurns, setKenBurns] = useState(false);
  // Film-grain/scratch tĩnh phủ khung hình — độc lập với kenBurns, có thể bật cả 2.
  const [grain, setGrain] = useState(false);
  const [effectsMsg, setEffectsMsg] = useState(null);
  const [formError, setFormError] = useState(null);

  // Channel profiles — bundles everything above except `audience` (per-video, not
  // per-channel) so a recurring channel's setup doesn't need re-picking every time.
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileSlug, setSelectedProfileSlug] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileMsg, setProfileMsg] = useState(null);

  // "Chạy toàn bộ pipeline" — chains every step below with the same shared state
  // instead of the user clicking each "Chạy ..." button in turn. Pauses right after
  // content-plan (the cheap step) unless `autoRunAll` is checked, since audio/video-
  // plan/scene generation are the steps that actually cost money.
  const [autoRunAll, setAutoRunAll] = useState(false);
  const [runAllActive, setRunAllActive] = useState(false);
  const [runAllPaused, setRunAllPaused] = useState(false);

  const planStatus = steps.plan?.status;
  const audioStatus = steps.audio?.status;
  const videoPlanStatus = steps["video-plan"]?.status;
  const rootStatus = steps.root?.status;
  const renderStatus = steps.render?.status;
  const doneSceneCount = Object.entries(steps).filter(([key, s]) => key.startsWith("scene:") && s.status === "done").length;

  const stepsRef = useRef(steps);
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  useEffect(() => {
    api.listProfiles().then((r) => setProfiles(r.profiles ?? [])).catch(() => {});
    api.listMusicLibrary().then((r) => setMusicTracks(r.tracks ?? [])).catch(() => {});
  }, []);

  // Restore which channel profile this project was made with, so re-opening a
  // project (from History, or right after Remix/Hàng loạt) doesn't silently drop
  // back to "no profile selected" — found live as a real bug: image-library reuse
  // and every profile-only setting (font, effects, models...) require a selected
  // profile, so losing it on reload effectively broke those features for any
  // returning project without the user noticing why. Two sources, since a
  // freshly-created batch project has no video-plan.json yet:
  //   1. `initialProfileSlug` — passed straight through from Batch.jsx/remix at the
  //      moment of creation (see App.jsx's handleCreated), before video-plan.json exists.
  //   2. video-plan.json's `imageLibrary.profileSlug` — set once video-planner has
  //      run; also how a remix project (which copies the source's video-plan.json
  //      wholesale) correctly recovers its source profile without any special-casing.
  // Runs once `profiles` is loaded so the match-by-slug below can actually find it.
  useEffect(() => {
    if (!id || !profiles.length || selectedProfileSlug) return;
    if (initialProfileSlug) {
      onSelectProfile(initialProfileSlug);
      return;
    }
    api
      .getFile(id, "video-plan.json")
      .then((plan) => {
        const slug = plan?.imageLibrary?.profileSlug;
        if (slug && profiles.some((p) => p.slug === slug)) onSelectProfile(slug);
      })
      .catch(() => {}); // video-plan.json not written yet — nothing to restore
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, profiles]);

  async function run(fn) {
    setFormError(null);
    try {
      await fn();
    } catch (err) {
      setFormError(err.message);
    }
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
    if (p.fontFamily !== undefined) setFontFamily(p.fontFamily);
    if (p.imageStylePrefix !== undefined) setImageStylePrefix(p.imageStylePrefix);
    if (p.kenBurns !== undefined) setKenBurns(p.kenBurns);
    if (p.grain !== undefined) setGrain(p.grain);
    if (p.plannerModel !== undefined) setPlannerModel(p.plannerModel);
    if (p.cheapModel !== undefined) setCheapModel(p.cheapModel);
    if (p.imgModel !== undefined) setImgModel(p.imgModel);
  }

  function onSelectProfile(slug) {
    setSelectedProfileSlug(slug);
    const p = profiles.find((x) => x.slug === slug);
    if (p) {
      applyProfile(p);
      setProfileName(p.name);
    }
  }

  async function saveCurrentAsProfile() {
    setProfileMsg(null);
    if (!profileName.trim()) {
      setProfileMsg({ ok: false, text: "Nhập tên profile trước đã." });
      return;
    }
    try {
      const saved = await api.saveProfile(profileName, {
        ttsProvider, ttsRate, ttsVoice, musicTrack, musicVolume, template, visualStyle, subStyle, fontFamily,
        imageStylePrefix, kenBurns, grain, plannerModel, cheapModel, imgModel,
      });
      const r = await api.listProfiles();
      setProfiles(r.profiles ?? []);
      setSelectedProfileSlug(saved.slug);
      setProfileMsg({ ok: true, text: `Đã lưu profile "${saved.name}".` });
    } catch (err) {
      setProfileMsg({ ok: false, text: err.message });
    }
  }

  async function deleteCurrentProfile() {
    if (!selectedProfileSlug) return;
    const name = profiles.find((p) => p.slug === selectedProfileSlug)?.name ?? selectedProfileSlug;
    if (!window.confirm(`Xoá profile "${name}"? Không thể hoàn tác.`)) return;
    setProfileMsg(null);
    try {
      await api.deleteProfile(selectedProfileSlug);
      const r = await api.listProfiles();
      setProfiles(r.profiles ?? []);
      setSelectedProfileSlug("");
      setProfileName("");
      setProfileMsg({ ok: true, text: `Đã xoá profile "${name}".` });
    } catch (err) {
      setProfileMsg({ ok: false, text: err.message });
    }
  }

  /** Polls `stepsRef` (kept in sync with the SSE-driven `steps` state) until the
   *  given step reaches "done"/"error" — lets the auto-run chain below `await` a
   *  step the same way a human would wait for its StatusBadge to turn green. */
  function waitForStep(stepKey, { pollMs = 800 } = {}) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const s = stepsRef.current[stepKey];
        if (s?.status === "done") return resolve(s);
        if (s?.status === "error") return reject(new Error(s.error || `Bước "${stepKey}" thất bại`));
        setTimeout(check, pollMs);
      };
      check();
    });
  }

  /** Runs a step only if it isn't already "done" — lets runAll() resume cleanly
   *  whether starting fresh or continuing after some steps were already run
   *  manually (the per-step buttons stay usable alongside this). */
  async function ensureStepDone(stepKey, fireFn) {
    if (stepsRef.current[stepKey]?.status === "done") return;
    await fireFn();
    await waitForStep(stepKey);
  }

  async function runAllPipeline({ skipPause = false } = {}) {
    setFormError(null);
    setRunAllActive(true);
    try {
      await ensureStepDone("plan", () =>
        api.runPlan(id, { idea, audience, platform: platform ?? undefined, model: plannerModel || undefined })
      );
      if (!autoRunAll && !skipPause) {
        setRunAllPaused(true);
        return;
      }
      setRunAllPaused(false);

      await ensureStepDone("audio", () => api.runAudio(id, { ttsProvider, ttsRate, ttsVoice: ttsVoice || undefined, musicTrack: musicTrack || undefined, musicVolume }));
      await ensureStepDone("video-plan", () =>
        api.runVideoPlan(id, {
          template,
          visualStyle,
          subStyle,
          fontFamily: template === "sub" ? fontFamily : undefined,
          imageStylePrefix: imageStylePrefix.trim() || undefined,
          model: plannerModel || undefined,
          cheapModel: cheapModel || undefined,
          imageModel: imgModel || undefined,
          imageLibraryEnabled,
          imageLibraryMaxReuse: imageLibraryMaxReuse === "" ? undefined : Number(imageLibraryMaxReuse),
          profileSlug: selectedProfileSlug || undefined,
          kenBurns,
          grain,
        })
      );

      const videoPlan = await api.getFile(id, "video-plan.json");
      for (const scene of videoPlan.scenes ?? []) {
        await ensureStepDone(`scene:${scene.sceneId}`, () => api.runScene(id, scene.sceneId));
      }

      await ensureStepDone("root", () => api.runRoot(id));
      await ensureStepDone("render", () => api.runRender(id));
    } catch (err) {
      setFormError(err.message);
    } finally {
      setRunAllActive(false);
    }
  }

  // Remix — only meaningful for style="sub" (has AI images worth reusing). Fetch the
  // current project's own video-plan.json once it exists, just to read `.template`
  // (gate the remix card) and `.fontFamily` (default value for the font override).
  const [sourceVideoPlan, setSourceVideoPlan] = useState(null);
  useEffect(() => {
    if (videoPlanStatus === "done") {
      api.getFile(id, "video-plan.json").then(setSourceVideoPlan).catch(() => {});
    }
  }, [id, videoPlanStatus]);

  const [remixPrompt, setRemixPrompt] = useState("");
  const [remixFont, setRemixFont] = useState("");
  const [remixModel, setRemixModel] = useState("");
  const [remixRunning, setRemixRunning] = useState(false);
  const [remixError, setRemixError] = useState(null);

  async function runRemix() {
    setRemixError(null);
    setRemixRunning(true);
    try {
      const res = await api.runRemix(id, { remixPrompt, fontFamily: remixFont || undefined, model: remixModel || undefined });
      setRemixPrompt("");
      onProjectCreated?.(res.id, remixPrompt, res.platform);
    } catch (err) {
      setRemixError(err.message);
    } finally {
      setRemixRunning(false);
    }
  }

  return (
    <div>
      <p className="muted">
        Project: {id}
        {sourceVideoPlan?.remixedFrom && <> · remix từ <strong>{sourceVideoPlan.remixedFrom}</strong></>}
        {totalUsage?.totalTokens ? (
          <>
            {" "}· Tổng token đã dùng: <strong>{totalUsage.totalTokens.toLocaleString("vi-VN")}</strong>
            {" "}· Tổng số lần gọi API: <strong>{(totalUsage.apiCalls ?? 0).toLocaleString("vi-VN")}</strong>
          </>
        ) : null}
      </p>
      {formError && <p className="error">{formError}</p>}

      <PipelineNav
        items={[
          { id: "step-config", label: "Cấu hình" },
          { id: "step-plan", label: "1. Content", status: planStatus },
          { id: "step-audio", label: "2. Audio", status: audioStatus },
          { id: "step-video-plan", label: "3. Video plan", status: videoPlanStatus },
          { id: "step-scenes", label: "Scenes", show: videoPlanStatus === "done" },
          { id: "step-root", label: "4. Root", status: rootStatus },
          { id: "step-render", label: "5. Render", status: renderStatus },
          { id: "step-remix", label: "Remix", show: sourceVideoPlan?.template === "sub" },
        ]}
      />

      <div className="card" id="step-config">
        <h3>Cấu hình pipeline</h3>

        <div className="inline-form">
          <select value={selectedProfileSlug} onChange={(e) => onSelectProfile(e.target.value)} title="Load profile kênh đã lưu">
            <option value="">— Chọn profile kênh (tuỳ chọn) —</option>
            {profiles.map((p) => (
              <option key={p.slug} value={p.slug}>{p.name}</option>
            ))}
          </select>
          <input
            placeholder="Tên profile để lưu (vd: Kênh chữa lành)"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            style={{ minWidth: "200px" }}
          />
          <button type="button" onClick={saveCurrentAsProfile}>
            {selectedProfileSlug ? "Cập nhật profile" : "Lưu thành profile mới"}
          </button>
          {selectedProfileSlug && (
            <button type="button" className="linklike" onClick={deleteCurrentProfile}>
              Xoá profile
            </button>
          )}
        </div>
        {profileMsg && <p className={profileMsg.ok ? "muted" : "error"}>{profileMsg.text}</p>}

        <p className="muted" style={{ marginTop: "12px" }}>Đối tượng xem — riêng cho video này, không lưu vào profile</p>
        <div className="inline-form">
          <input
            placeholder="Đối tượng xem (audience) — bắt buộc"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
          />
        </div>

        <p className="muted" style={{ marginTop: "12px" }}>Audio (TTS)</p>
        <div className="inline-form">
          <select value={ttsProvider} onChange={(e) => setTtsProvider(e.target.value)}>
            <option value="edge-tts">edge-tts (free)</option>
            <option value="elevenlabs">elevenlabs</option>
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
          </select>
          {template === "motion" ? (
            <select value={visualStyle} onChange={(e) => setVisualStyle(e.target.value)}>
              <option value="animation">Nền CSS/GSAP thuần</option>
              <option value="ai-image">Nền ảnh AI (wan2.6-image)</option>
            </select>
          ) : (
            <>
              <select value={subStyle} onChange={(e) => setSubStyle(e.target.value)}>
                <option value="image_full_focus">Full Focus (ảnh full-bleed + sub đáy)</option>
              </select>
              <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} title="Font phụ đề (đã xác nhận hỗ trợ tiếng Việt)">
                <option value="Itim">Itim (viết tay, tròn — mặc định)</option>
                <option value="Mali">Mali (viết tay, nhiều độ đậm)</option>
                <option value="Pacifico">Pacifico (script mềm mại)</option>
                <option value="Charm">Charm (thư pháp, thanh)</option>
                <option value="Sriracha">Sriracha (bút lông, khoẻ)</option>
                <option value="Amatic SC">Amatic SC (marker, cô đặc)</option>
              </select>
            </>
          )}
          {(template === "sub" || visualStyle === "ai-image") && (
            <>
              <textarea
                placeholder='Phong cách ảnh AI (để trống = "minimalist matchstick figure") — vd chủ thể, chất liệu, tông màu...'
                value={imageStylePrefix} onChange={(e) => setImageStylePrefix(e.target.value)}
                rows={2}
              />
              <button type="button" className="linklike" onClick={() => setTestPromptOpen((v) => !v)}>
                {testPromptOpen ? "Ẩn test prompt" : "Test prompt (thử prefix trước khi chạy pipeline)"}
              </button>
              {testPromptOpen && (
                <div className="inline-form" style={{ alignItems: "flex-start" }}>
                  <input
                    value={testPromptSubject}
                    onChange={(e) => setTestPromptSubject(e.target.value)}
                    placeholder='Chủ thể chính — vd: "1 cô gái đang đọc sách"'
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
          {template === "sub" && (
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
              {videoPlanStatus === "done" && (
                <button
                  type="button"
                  title="CHỈ ghi field vào video-plan.json, không gọi lại LLM — chưa làm video đổi ngay. Sau khi bấm, còn phải tự bấm 'Generate' lại từng scene (ảnh giữ nguyên, chỉ HTML đổi) rồi chạy lại Root + Render thì effect mới thật sự xuất hiện."
                  onClick={() =>
                    run(async () => {
                      setEffectsMsg(null);
                      const r = await api.setEffects(id, { kenBurns, grain });
                      setEffectsMsg(
                        `Đã lưu vào video-plan.json (kenBurns=${r.kenBurns}, grain=${r.grain}), KHÔNG tốn phí LLM — nhưng video CHƯA đổi. Để effect thật sự xuất hiện: bấm "Generate" lại từng scene bên dưới (ảnh giữ nguyên, chỉ HTML đổi), rồi chạy lại Root + Render.`
                      );
                    })
                  }
                >
                  Lưu effect vào video-plan (chưa render, cần Generate lại scene)
                </button>
              )}
            </div>
          )}
          {effectsMsg && <p style={{ fontSize: "0.85em", opacity: 0.85 }}>{effectsMsg}</p>}
          <ModelSelect value={plannerModel} onChange={setPlannerModel} options={EXPENSIVE_MODELS} title="Model (đắt) cho content-planner + video-planner" />
          <ModelSelect value={cheapModel} onChange={setCheapModel} options={CHEAP_MODELS} title="Model (rẻ) cho scene-writer + ghép video" />
          {(template === "sub" || visualStyle === "ai-image") && (
            <ModelSelect value={imgModel} onChange={setImgModel} options={IMAGE_MODELS} title="Model sinh ảnh AI" />
          )}
        </div>

        {(template === "sub" || visualStyle === "ai-image") && (
          <div className="inline-form" style={{ marginTop: "8px" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <input
                type="checkbox" checked={imageLibraryEnabled} onChange={(e) => setImageLibraryEnabled(e.target.checked)}
                style={{ width: "auto", marginBottom: 0 }}
                disabled={!selectedProfileSlug}
              />
              Tìm ảnh có sẵn trong thư viện trước khi sinh mới {!selectedProfileSlug && "(cần chọn profile kênh ở trên)"}
            </label>
            {imageLibraryEnabled && (
              <input
                type="number" min="0" title="Tối đa số scene được tái dùng ảnh (để trống = không giới hạn)"
                placeholder="Không giới hạn"
                value={imageLibraryMaxReuse} onChange={(e) => setImageLibraryMaxReuse(e.target.value)}
                style={{ width: "140px" }}
              />
            )}
          </div>
        )}

        <p className="muted" style={{ marginTop: "16px" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            <input type="checkbox" checked={autoRunAll} onChange={(e) => setAutoRunAll(e.target.checked)} style={{ width: "auto", marginBottom: 0 }} />
            Chạy 1 mạch, không dừng để xác nhận (audio + ảnh AI tốn phí)
          </label>
        </p>
        <button
          type="button"
          disabled={!audience.trim() || runAllActive}
          onClick={() => runAllPipeline()}
        >
          {runAllActive ? "Đang chạy..." : "Chạy toàn bộ pipeline"}
        </button>
        {runAllPaused && (
          <p className="muted">
            Đã tạo xong <code>scenes.json</code> (bước rẻ). Kiểm tra ở khung "Scenes (nội
            dung)" bên dưới, rồi bấm tiếp để chạy phần tốn phí (audio + video-plan +
            scene + render).
            {" "}
            <button type="button" onClick={() => runAllPipeline({ skipPause: true })} disabled={runAllActive}>
              Tiếp tục pipeline
            </button>
          </p>
        )}
      </div>

      <StepRow id="step-plan" title="1. Content plan" status={planStatus} error={steps.plan?.error} usage={steps.plan?.usage}>
        {planStatus !== "done" && planStatus !== "running" && (
          <button
            type="button"
            disabled={!audience.trim()}
            onClick={() => run(() => api.runPlan(id, { idea, audience, platform: platform ?? undefined, model: plannerModel || undefined }))}
          >
            Chạy content-planner
          </button>
        )}
        {planStatus === "running" && <LiveLog events={events} step="plan" />}
      </StepRow>
      {planStatus === "done" && (
        <CheckpointPanel id={id} file="scenes.json" title="Scenes (nội dung)" refreshKey={steps.plan?.at} />
      )}

      <StepRow id="step-audio" title="2. Audio (TTS)" status={audioStatus} error={steps.audio?.error}>
        {planStatus === "done" && audioStatus !== "done" && audioStatus !== "running" && (
          <button type="button" onClick={() => run(() => api.runAudio(id, { ttsProvider, ttsRate, ttsVoice: ttsVoice || undefined, musicTrack: musicTrack || undefined, musicVolume }))}>
            Chạy audio
          </button>
        )}
        {planStatus === "done" && audioStatus === "done" && (
          <button
            type="button"
            className="linklike"
            title="Chạy lại bước audio — scene đã có file MP3 sẽ được bỏ qua (không tốn phí TTS lại), nhưng scene_duration/khoảng nghỉ giữa scene luôn được TÍNH LẠI theo config mới nhất (vd sau khi đổi buffer khoảng nghỉ)"
            onClick={() => {
              if (!window.confirm('Chạy lại audio? Scene đã có file MP3 sẽ được giữ nguyên (không tốn phí TTS lại), chỉ scene_duration/khoảng nghỉ được tính lại. Sau đó cần Generate lại từng scene bên dưới (không cần chạy lại video-planner) rồi Root + Render để áp dụng.')) return;
              run(() => api.runAudio(id, { ttsProvider, ttsRate, ttsVoice: ttsVoice || undefined, musicTrack: musicTrack || undefined, musicVolume }));
            }}
          >
            Chạy lại audio
          </button>
        )}
        {audioStatus === "running" && <LiveLog events={events} step="audio" />}
      </StepRow>

      <StepRow id="step-video-plan" title="3. Video plan" status={videoPlanStatus} error={steps["video-plan"]?.error} usage={steps["video-plan"]?.usage}>
        {audioStatus === "done" && videoPlanStatus !== "done" && videoPlanStatus !== "running" && (
          <button
            type="button"
            onClick={() =>
              run(() =>
                api.runVideoPlan(id, {
                  template,
                  visualStyle,
                  subStyle,
                  fontFamily: template === "sub" ? fontFamily : undefined,
                  imageStylePrefix: imageStylePrefix.trim() || undefined,
                  model: plannerModel || undefined,
                  cheapModel: cheapModel || undefined,
                  imageModel: imgModel || undefined,
                  imageLibraryEnabled,
                  imageLibraryMaxReuse: imageLibraryMaxReuse === "" ? undefined : Number(imageLibraryMaxReuse),
                  profileSlug: selectedProfileSlug || undefined,
                  kenBurns,
                  grain,
                })
              )
            }
          >
            Chạy video-planner
          </button>
        )}
        {audioStatus === "done" && videoPlanStatus === "done" && (
          <button
            type="button"
            className="linklike"
            title="Chạy lại video-planner (gọi LLM thật, tốn phí) — dùng khi đổi style/model/imageStylePrefix và muốn viết lại toàn bộ visual_brief/image_prompt"
            onClick={() => {
              if (!window.confirm('Chạy lại video-planner? Gọi LLM thật (tốn phí), có thể viết lại khác đi visual_brief/image_prompt của mọi scene. Sau đó cần Generate lại từng scene + Root + Render.')) return;
              run(() =>
                api.runVideoPlan(id, {
                  template,
                  visualStyle,
                  subStyle,
                  fontFamily: template === "sub" ? fontFamily : undefined,
                  imageStylePrefix: imageStylePrefix.trim() || undefined,
                  model: plannerModel || undefined,
                  cheapModel: cheapModel || undefined,
                  imageModel: imgModel || undefined,
                  imageLibraryEnabled,
                  imageLibraryMaxReuse: imageLibraryMaxReuse === "" ? undefined : Number(imageLibraryMaxReuse),
                  profileSlug: selectedProfileSlug || undefined,
                  kenBurns,
                  grain,
                })
              );
            }}
          >
            Chạy lại video-planner
          </button>
        )}
        {videoPlanStatus === "running" && <LiveLog events={events} step="video-plan" />}
      </StepRow>
      {videoPlanStatus === "done" && (
        <CheckpointPanel id={id} file="video-plan.json" title="Video plan" refreshKey={steps["video-plan"]?.at} />
      )}

      {videoPlanStatus === "done" && (
        <div id="step-scenes">
          <SceneGrid id={id} steps={steps} events={events} refreshKey={steps["video-plan"]?.at} audioReady={audioStatus === "done"} />
        </div>
      )}

      <StepRow id="step-root" title="4. Ghép video (root)" status={rootStatus} error={steps.root?.error} usage={steps.root?.usage}>
        {videoPlanStatus === "done" && rootStatus !== "running" && (
          <>
            <p className="muted">
              Ghép các scene đã generate ({doneSceneCount}) vào timeline gốc — bắt buộc
              trước khi Render, nếu không video xuất ra sẽ trống/đen.
            </p>
            <button type="button" disabled={doneSceneCount === 0} onClick={() => run(() => api.runRoot(id))}>
              {rootStatus === "done" ? "Ghép lại" : "Ghép video"}
            </button>
          </>
        )}
        {rootStatus === "running" && <LiveLog events={events} step="root" />}
      </StepRow>
      {rootStatus === "done" && (
        <CheckpointPanel id={id} file="index.html" title="Root composition" refreshKey={steps.root?.at} />
      )}

      <StepRow id="step-render" title="5. Render" status={renderStatus} error={steps.render?.error}>
        {rootStatus === "done" && renderStatus !== "running" && (
          <button type="button" onClick={() => run(() => api.runRender(id))}>
            {renderStatus === "done" ? "Render lại" : "Render"}
          </button>
        )}
        {videoPlanStatus === "done" && rootStatus !== "done" && (
          <p className="muted">Cần hoàn thành bước 4 (Ghép video) trước.</p>
        )}
      </StepRow>
      {renderStatus === "done" && <RenderPlayer id={id} refreshKey={steps.render?.at} />}

      {sourceVideoPlan?.template === "sub" && (
        <div className="card" id="step-remix">
          <h3>Remix video này</h3>
          <p className="muted">
            Tạo 1 project MỚI, giữ nguyên ảnh AI + số scene của video này — chỉ viết lại
            lời thoại theo yêu cầu bên dưới (không tốn phí sinh ảnh lại).
          </p>
          <div className="inline-form">
            <textarea
              rows={2}
              placeholder="Yêu cầu remix — vd: đổi văn phong hài hước hơn, đổi đối tượng sang phụ huynh, viết ngắn gọn hơn..."
              value={remixPrompt}
              onChange={(e) => setRemixPrompt(e.target.value)}
            />
            <select value={remixFont} onChange={(e) => setRemixFont(e.target.value)} title="Font chữ cho video remix">
              <option value="">Giữ font gốc{sourceVideoPlan.fontFamily ? ` (${sourceVideoPlan.fontFamily})` : ""}</option>
              {FONT_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <ModelSelect value={remixModel} onChange={setRemixModel} options={EXPENSIVE_MODELS} title="Model viết lại narration cho remix" />
            <button type="button" disabled={!remixPrompt.trim() || remixRunning} onClick={runRemix}>
              {remixRunning ? "Đang remix..." : "Remix thành project mới"}
            </button>
          </div>
          {remixError && <p className="error">{remixError}</p>}
        </div>
      )}

      <PreviewFrame id={id} />
      <p className="muted">
        Muốn xem riêng từng scene: mở Preview ở trên, chọn scene tương ứng trong danh
        sách bên trái (mục "Comps") của HyperFrames Studio.
      </p>
    </div>
  );
}
