import { useState } from "react";
import { StatusBadge } from "./StatusBadge.jsx";
import { TestScriptPreview } from "./TestScriptPreview.jsx";

const HOOK_LABELS = {
  "so-lieu": "Số liệu",
  "trai-chieu": "Trái chiều",
  "ke-chuyen": "Kể chuyện",
  "cau-hoi": "Câu hỏi",
  "thu-nhan": "Thú nhận",
  "tuyen-bo": "Tuyên bố",
};

const TONE_LABELS = {
  "day-kien-thuc": "Dạy kiến thức",
  "de-ton-thuong": "Dễ tổn thương",
  "bold-provocative": "Bold",
  "thuc-hanh-tung-buoc": "Thực hành",
};

// idea.status ("pending"/"creating"/"planning"/"done"/"error") normalized into the
// 4 buckets StatusBadge already understands — "creating"/"planning" both read as
// "running" there (loses which phase, gained by reusing the existing component
// instead of a bespoke one for 2 extra labels).
const STATUS_MAP = { pending: "idle", creating: "running", planning: "running", done: "done", error: "error" };

const PHASE_LABEL = { creating: "Đang tạo project…", planning: "Đang viết kịch bản…" };

export function IdeaCard({
  idea,
  disabled,
  onEdit,
  onToggleKeep,
  onDelete,
  onOpen,
  audience,
  platform,
  profileSlug,
  testKind = "content-planner", // "content-planner" (Pipeline/Hàng loạt) | "hook" (Đọc Caption)
  testExtraParams, // hook's own {nicheDescription, ctaText} — merged into TestScriptPreview's params instead of audience/platform
  onUseTestResult, // (idea, testId) => Promise — creates the real project + promotes the test result; omit to hide the button (e.g. Hook tab, not wired yet)
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(idea.idea);
  const [testOpen, setTestOpen] = useState(false);

  function saveEdit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== idea.idea) onEdit(trimmed);
    setEditing(false);
  }

  return (
    <div className={`idea-card${idea.kept === false ? " idea-card-dropped" : ""}`}>
      <div className="step-row-badges">
        <StatusBadge status={STATUS_MAP[idea.status] ?? "idle"} />
        {PHASE_LABEL[idea.status] && <span className="muted">{PHASE_LABEL[idea.status]}</span>}
      </div>

      {editing ? (
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus />
      ) : (
        <p className="idea-text">{idea.idea}</p>
      )}

      {idea.scriptText ? (
        <div className="idea-badges">
          <span className="idea-badge">Kịch bản có sẵn</span>
        </div>
      ) : (
        <div className="idea-badges">
          <span className="idea-badge">{HOOK_LABELS[idea.hookStyle] ?? idea.hookStyle}</span>
          <span className="idea-badge">{TONE_LABELS[idea.tone] ?? idea.tone}</span>
          <span className="idea-badge idea-badge-subtopic">{idea.subTopic}</span>
        </div>
      )}

      {idea.status === "error" && idea.error && <p className="error">{idea.error}</p>}

      <div className="idea-card-actions">
        {editing ? (
          <>
            <button type="button" onClick={saveEdit}>Lưu</button>
            <button type="button" className="linklike" onClick={() => { setDraft(idea.idea); setEditing(false); }}>Huỷ</button>
          </>
        ) : (
          <>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <input
                type="checkbox"
                checked={idea.kept !== false}
                disabled={disabled}
                onChange={(e) => onToggleKeep(e.target.checked)}
              />
              Giữ
            </label>
            <button type="button" className="linklike" disabled={disabled} onClick={() => setEditing(true)}>Sửa</button>
            <button type="button" className="linklike" disabled={disabled} onClick={onDelete}>Xoá</button>
            {idea.status === "pending" && !idea.scriptText && (
              <button type="button" className="linklike" onClick={() => setTestOpen((v) => !v)}>
                {testOpen ? "Ẩn test kịch bản" : "Test kịch bản"}
              </button>
            )}
            {idea.status === "done" && idea.projectId && (
              <button type="button" onClick={() => onOpen(idea.projectId, idea.idea, idea.platform)}>Mở project</button>
            )}
          </>
        )}
      </div>
      {testOpen && (
        <TestScriptPreview
          kind={testKind}
          disabled={testKind === "hook" ? !testExtraParams?.nicheDescription?.trim() : !audience?.trim()}
          getParams={() => ({ idea: idea.idea, audience, platform, profileSlug, ...testExtraParams })}
          onUse={onUseTestResult && idea.status === "pending" ? (testId) => onUseTestResult(idea, testId) : undefined}
        />
      )}
    </div>
  );
}
