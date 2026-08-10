/**
 * Renders the raw SSE `events` stream (already captured by useJobStatus, previously
 * only used to derive step status badges) as a small scrolling log — so a step that
 * takes 30-60s (video-plan, scene generate with a lint-fix loop, audio TTS per
 * scene) shows *something* moving instead of just a static "Đang chạy" badge.
 * Unknown/irrelevant event shapes return null from formatEvent and are dropped
 * rather than dumped as raw JSON — every agent/pipeline task emits a different
 * event shape (see generate-audio.mjs vs run-agent.mjs vs root-composer.mjs), so
 * this only picks the ones worth a human reading live.
 */
function formatEvent(e) {
  switch (e.type) {
    case "start":
      return `Bắt đầu${e.provider ? ` (${e.provider}` : ""}${e.sceneCount ? `, ${e.sceneCount} scene)` : e.provider ? ")" : ""}`;
    case "scene-start":
      return `${e.sceneId}: bắt đầu TTS...`;
    case "scene-skip":
      return `${e.sceneId}: đã có audio, bỏ qua`;
    case "scene-tts-done":
      return `${e.sceneId}: TTS xong (~${e.voDuration?.toFixed?.(2)}s, ${Math.round((e.audioBytes ?? 0) / 1024)}KB)`;
    case "scene-error":
      return `${e.sceneId}: LỖI TTS — ${e.error}`;
    case "scene-done":
      return `${e.sceneId}: ${e.voDuration?.toFixed?.(2)}s voice → ${e.sceneDuration}s scene`;
    case "anchor-not-found":
      return `Cảnh báo: không tìm thấy mốc "${e.target}" trong timestamps`;
    case "music-fallback":
      return `Nhạc "${e.requested}" chưa có trong thư viện — dùng tạm "${e.using}"`;
    case "music-selected":
      return `Nhạc nền: ${e.track}.mp3`;
    case "sfx-copied":
      return `Copy SFX: ${e.id}.mp3`;
    case "sfx-missing":
      return `Cảnh báo: SFX "${e.id}" không có trong thư viện`;
    case "music-copied":
      return `Copy nhạc: ${e.track}.mp3`;
    case "done":
      return e.failedSceneIds?.length
        ? `Hoàn tất — CẢNH BÁO ${e.failedSceneIds.length} scene lỗi: ${e.failedSceneIds.join(", ")}`
        : "Hoàn tất";
    case "malformed-tool-call":
      return `⚠ Model trả JSON lỗi trong tool call — tự yêu cầu làm lại (lượt ${e.turn})`;
    case "model-fallback":
      return `⚠ Model "${e.from}" hết quota/rate-limit — tự chuyển sang "${e.to}"`;
    case "assistant": {
      const calls = e.message?.tool_calls;
      return calls?.length
        ? `[lượt ${e.turn}] gọi ${calls.map((c) => c.function.name).join(", ")}`
        : `[lượt ${e.turn}] model phản hồi`;
    }
    case "tool":
      return `[lượt ${e.turn}] ${e.name} → ${e.result?.ok ? "ok" : "LỖI: " + e.result?.error}`;
    case "lint":
      return `Lint lần ${e.attempt + 1}: ${e.newFindingCount} lỗi mới`;
    case "static-check":
      return `Cảnh báo tĩnh: ${e.staticWarnings?.length ?? 0} warning`;
    case "image":
      return `Ảnh AI đã lưu: ${e.outPath}`;
    case "image-skip":
      return `Ảnh AI đã có sẵn, bỏ qua sinh lại`;
    case "image-reused":
      return `Tái dùng ảnh từ thư viện (tiết kiệm phí sinh ảnh)`;
    case "write":
      return `Đã ghi: ${e.outPath}`;
    case "scene-id-mismatch":
      return `LỖI: sceneId remix không khớp — cần [${e.want?.join(", ")}], nhận [${e.got?.join(", ")}]`;
    case "duration-check":
      return e.ok ? null : `Cảnh báo: tổng thời lượng scene không khớp kế hoạch`;
    case "image-prompt-hygiene":
      return e.ok
        ? null
        : `Cảnh báo: ${e.findings?.length ?? 0} image_prompt còn dính chữ/màu neon (${e.findings?.map((f) => f.sceneId).join(", ")}) — nên kiểm tra lại trước khi sinh ảnh`;
    case "diversity-check":
      return e.issue === "count-mismatch"
        ? `Cảnh báo: sinh ${e.actual} ý tưởng thay vì ${e.expected} yêu cầu`
        : `Cảnh báo: ý tưởng #${(e.index ?? 0) + 1} trùng hookStyle với ý tưởng trước`;
    case "transcribe-start":
      return "Đang phiên âm audio (whisper local, có thể mất vài phút)...";
    case "transcribe-done":
      return `Phiên âm xong: ${e.wordCount} từ${e.garbageRatio ? ` (${Math.round(e.garbageRatio * 100)}% token rác)` : ""}`;
    case "scene-cut-retry":
      return `Cắt cảnh lỗi, thử lại (lần ${e.attempt}): ${e.error}`;
    case "scene-cut-done":
      return `Đã cắt ${e.sceneCount} scene theo ý nghĩa`;
    case "scene-audio-cut-start":
      return `Bắt đầu cắt audio gốc cho ${e.sceneCount} scene...`;
    case "scene-audio-cut-done":
      return `${e.sceneId}: đã cắt audio`;
    case "scene-audio-cut-error":
      return `${e.sceneId}: LỖI cắt audio — ${e.error}`;
    default:
      return null;
  }
}

/** @param {{events: object[], step: string, maxLines?: number}} props */
export function LiveLog({ events, step, maxLines = 6 }) {
  const lines = (events ?? [])
    .filter((e) => e.step === step)
    .map((e) => formatEvent(e))
    .filter(Boolean);
  if (!lines.length) return null;
  const shown = lines.slice(-maxLines);
  return (
    <div className="live-log">
      {shown.map((text, i) => (
        <div key={i} className="live-log-line">{text}</div>
      ))}
    </div>
  );
}
