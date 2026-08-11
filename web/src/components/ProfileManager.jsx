import { useEffect, useState } from "react";
import { api } from "../api.js";
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
export function ProfileManager({ profiles, onProfilesChanged }) {
  const [expanded, setExpanded] = useState(false);

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
  const [kenBurns, setKenBurns] = useState(false);
  const [grain, setGrain] = useState(false);
  const [plannerModel, setPlannerModel] = useState("");
  const [cheapModel, setCheapModel] = useState("");
  const [imgModel, setImgModel] = useState("");

  const [footageMinClips, setFootageMinClips] = useState(1);
  const [footageMaxClips, setFootageMaxClips] = useState(3);
  const [footageMinSeconds, setFootageMinSeconds] = useState(3);
  const [footageMaxSeconds, setFootageMaxSeconds] = useState(6);
  const [footageFlipEnabled, setFootageFlipEnabled] = useState(false);
  const [footageSpeedEnabled, setFootageSpeedEnabled] = useState(false);
  const [footageSpeedMin, setFootageSpeedMin] = useState(1.0);
  const [footageSpeedMax, setFootageSpeedMax] = useState(1.3);
  const [footageLibraryCount, setFootageLibraryCount] = useState(null);

  const [channelTheme, setChannelTheme] = useState("");
  const [defaultAudience, setDefaultAudience] = useState("");

  const [testPromptOpen, setTestPromptOpen] = useState(false);
  const [testPromptSubject, setTestPromptSubject] = useState("");
  const [testPromptLoading, setTestPromptLoading] = useState(false);
  const [testPromptResult, setTestPromptResult] = useState(null);
  const [testPromptError, setTestPromptError] = useState(null);

  useEffect(() => {
    if (!expanded) return;
    api.listMusicLibrary().then((r) => setMusicTracks(r.tracks ?? [])).catch(() => {});
    api.getFootageLibraryInfo().then((r) => setFootageLibraryCount(r.count)).catch(() => setFootageLibraryCount(null));
  }, [expanded]);

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
    if (p.kenBurns !== undefined) setKenBurns(p.kenBurns);
    if (p.grain !== undefined) setGrain(p.grain);
    if (p.plannerModel !== undefined) setPlannerModel(p.plannerModel);
    if (p.cheapModel !== undefined) setCheapModel(p.cheapModel);
    if (p.imgModel !== undefined) setImgModel(p.imgModel);
    if (p.footageMinClips !== undefined) setFootageMinClips(p.footageMinClips);
    if (p.footageMaxClips !== undefined) setFootageMaxClips(p.footageMaxClips);
    if (p.footageMinSeconds !== undefined) setFootageMinSeconds(p.footageMinSeconds);
    if (p.footageMaxSeconds !== undefined) setFootageMaxSeconds(p.footageMaxSeconds);
    if (p.footageFlipEnabled !== undefined) setFootageFlipEnabled(p.footageFlipEnabled);
    if (p.footageSpeedEnabled !== undefined) setFootageSpeedEnabled(p.footageSpeedEnabled);
    if (p.footageSpeedMin !== undefined) setFootageSpeedMin(p.footageSpeedMin);
    if (p.footageSpeedMax !== undefined) setFootageSpeedMax(p.footageSpeedMax);
    if (p.channelTheme !== undefined) setChannelTheme(p.channelTheme);
    if (p.defaultAudience !== undefined) setDefaultAudience(p.defaultAudience);
  }

  function onSelectProfile(slug) {
    setSelectedSlug(slug);
    setProfileMsg(null);
    const p = profiles.find((x) => x.slug === slug);
    if (p) {
      applyProfile(p);
      setProfileName(p.name);
    }
  }

  function startNewProfile() {
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
        imageStylePrefix, kenBurns, grain, plannerModel, cheapModel, imgModel,
        footageMinClips, footageMaxClips, footageMinSeconds, footageMaxSeconds,
        footageFlipEnabled, footageSpeedEnabled, footageSpeedMin, footageSpeedMax,
        channelTheme, defaultAudience,
      });
      setSelectedSlug(saved.slug);
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
            <p className="muted">
              Kho footage: {footageLibraryCount === null ? "đang kiểm tra..." : `${footageLibraryCount} video`}
              {footageLibraryCount === 0 && " — chưa có file .mp4 nào trong assets/footage-library/"}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span>Số clip/scene:</span>
              <input type="number" min="1" value={footageMinClips} onChange={(e) => setFootageMinClips(e.target.value)} style={{ width: "60px" }} />
              <span>–</span>
              <input type="number" min="1" value={footageMaxClips} onChange={(e) => setFootageMaxClips(e.target.value)} style={{ width: "60px" }} />
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
