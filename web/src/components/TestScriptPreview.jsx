import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useEventStream } from "../useJobStatus.js";
import { LiveLog } from "./LiveLog.jsx";

/**
 * "Xem trước kịch bản" — lets a user run the real script-writing agent (same one
 * used for real projects) into a throwaway scratch dir and read the raw text back,
 * WITHOUT creating a real project or spending on the rest of the pipeline. Exists so
 * a profile's `contentPlaybook` (persona/giọng kể/điều nên-không nên) can be
 * iterated on quickly — found live (user request): tuning that text previously
 * required a full real run (content-plan + everything downstream) just to see if the
 * wording landed. Shared across every tab that has a script-generation step
 * (Pipeline/Batch via `kind="content-planner"`, Investigation via `kind="investigation"`,
 * Hook via `kind="hook"`) — see routes.mjs's POST /test-content-plan.
 *
 * `getParams()` is called fresh on each click (not read once at mount) so it always
 * reflects the caller's CURRENT form state.
 *
 * `onUse` (optional): if provided, shows a "Dùng kết quả này" button that hands the
 * raw `testId` to the CALLER — this component has no opinion on what "use" means
 * (Pipeline.jsx: copy straight into the already-created project; Batch.jsx's
 * IdeaCard: create the project first, then copy) — see routes.mjs's
 * POST /projects/:id/plan/use-test-result for the actual file copy. Deliberately
 * offered only for the UNTOUCHED preview text (the textarea below is read-only) —
 * scenes.json (what audio/timing actually reads) would silently stay on the old
 * cut if a hand-edited master_content.md were promoted instead.
 */
export function TestScriptPreview({ kind, getParams, disabled, onUse }) {
  const [testId, setTestId] = useState(null);
  const [result, setResult] = useState(null); // { text, status } once fetched
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [using, setUsing] = useState(false);
  const [used, setUsed] = useState(false);

  const { steps, events } = useEventStream(testId ? api.batchEventsUrl(testId) : null);
  const stepStatus = steps["test-plan"]?.status;

  async function run() {
    setError(null);
    setResult(null);
    setTestId(null);
    setUsed(false);
    const params = getParams();
    if (!params?.idea?.trim()) {
      setError('Cần nhập "Ý tưởng" trước.');
      return;
    }
    setRunning(true);
    try {
      const { testId: id } = await api.testContentPlan({ kind, ...params });
      setTestId(id);
    } catch (err) {
      setError(err.message);
      setRunning(false);
    }
  }

  // Fetches the final file content once the step settles (done/error) — SSE only
  // carries live events, not the written file itself.
  useEffect(() => {
    if (!testId || !running || (stepStatus !== "done" && stepStatus !== "error")) return;
    api
      .getTestContentPlanResult(testId)
      .then((r) => {
        setResult(r);
        if (stepStatus === "error") setError(steps["test-plan"]?.error ?? "Lỗi không rõ");
      })
      .catch((err) => setError(err.message))
      .finally(() => setRunning(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId, running, stepStatus]);

  async function handleUse() {
    setUsing(true);
    setError(null);
    try {
      await onUse(testId);
      setUsed(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setUsing(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: "12px" }}>
      <div className="step-row-head">
        <h3>Xem trước kịch bản (test, không tạo project)</h3>
        <button type="button" disabled={disabled || running} onClick={run}>
          {running ? "Đang sinh kịch bản…" : "Sinh kịch bản test"}
        </button>
      </div>
      <p className="muted">
        Chạy đúng agent viết kịch bản thật, nhưng ghi vào thư mục tạm — không tạo project, không tốn thêm bước nào
        khác. Dùng để chỉnh dần "Content playbook" của profile trước khi chạy thật.
      </p>
      {running && <LiveLog events={events} step="test-plan" maxLines={8} />}
      {error && <p className="error">{error}</p>}
      {result?.text && (
        <>
          <textarea readOnly value={result.text} rows={16} style={{ width: "100%", fontFamily: "monospace", fontSize: "13px" }} />
          {onUse && stepStatus === "done" && (
            <div style={{ marginTop: "8px" }}>
              {used ? (
                <p className="muted">Đã dùng kết quả này — không cần chạy content-plan thật nữa.</p>
              ) : (
                <button type="button" disabled={using} onClick={handleUse}>
                  {using ? "Đang dùng…" : "Dùng kết quả này (bỏ qua content-plan thật, không tốn phí lần 2)"}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
