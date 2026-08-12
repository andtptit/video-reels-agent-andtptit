/**
 * Per-project job progress: persisted to `job-status.json` inside the project dir
 * (state stays on disk, same philosophy as the rest of the pipeline — no database)
 * and mirrored live to an in-process EventEmitter so routes.mjs can stream it over
 * SSE without polling the file.
 *
 * One EventEmitter per project dir, kept in a module-level Map for the life of the
 * server process — fine since a single Node process is the whole backend (no
 * horizontal scaling in scope here).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { EventEmitter } from "events";
import { registerCancellable, unregisterCancellable, CancelledError } from "./cancel-registry.mjs";

const emitters = new Map();

function statusPath(projectDir) {
  return join(projectDir, "job-status.json");
}

export function readJobStatus(projectDir) {
  const p = statusPath(projectDir);
  if (!existsSync(p)) return { steps: {} };
  return JSON.parse(readFileSync(p, "utf-8"));
}

function writeJobStatusFile(projectDir, status) {
  writeFileSync(statusPath(projectDir), JSON.stringify(status, null, 2));
}

/**
 * Compact 1-line status summary for a project — used by ProjectPicker so the user
 * can see which project is mid-pipeline/errored/rendered WITHOUT opening each one
 * to check (confirmed as a real friction point: with several projects accumulated
 * this session, re-checking each one's Pipeline view just to find "which one had
 * the audio error" was tedious). Reads job-status.json + (if present)
 * video-plan.json's scene count for an accurate "N/M scene" fraction — cheap for a
 * personal-scale tool with a handful of projects, not worth caching.
 */
export function summarizeProjectStatus(projectDir) {
  const status = readJobStatus(projectDir);
  const steps = status.steps ?? {};
  // `renderDone` is a separate stable boolean (not just `label === "Đã render"") so
  // callers like the History tab can filter reliably without string-matching a
  // Vietnamese label that's free to reword later.
  const renderDone = steps.render?.status === "done";
  // Separate boolean from `label` — label's priority order (errored > rendered >
  // scene-count > ...) can put a project mid-run behind a stabler-looking label like
  // "3/6 scene xong" even while a scene is actively running, so callers that need to
  // know "is ANYTHING running right now" (the header's running-projects banner)
  // can't just string-match `label`.
  const isRunning = Object.values(steps).some((s) => s.status === "running");
  if (!Object.keys(steps).length) return { label: "Chưa bắt đầu", hasError: false, renderDone: false, isRunning: false };

  const erroredStep = Object.values(steps).find((s) => s.status === "error");
  const cancelledStep = Object.values(steps).find((s) => s.status === "cancelled");
  const sceneEntries = Object.entries(steps).filter(([k]) => k.startsWith("scene:"));
  const sceneDone = sceneEntries.filter(([, s]) => s.status === "done").length;

  let sceneTotal = sceneEntries.length;
  const videoPlanFile = join(projectDir, "video-plan.json");
  if (existsSync(videoPlanFile)) {
    try {
      const plan = JSON.parse(readFileSync(videoPlanFile, "utf-8"));
      if (plan.scenes?.length) sceneTotal = plan.scenes.length;
    } catch {
      /* malformed file — fall back to attempted-scene count above */
    }
  }

  if (erroredStep) return { label: `Lỗi ở "${erroredStep.step}"`, hasError: true, renderDone, isRunning };
  if (cancelledStep) return { label: `Đã huỷ ở "${cancelledStep.step}"`, hasError: false, renderDone, isRunning };
  if (renderDone) return { label: "Đã render", hasError: false, renderDone, isRunning };
  if (steps.root?.status === "done") return { label: "Đã ghép, chưa render", hasError: false, renderDone, isRunning };
  if (sceneTotal > 0) return { label: `${sceneDone}/${sceneTotal} scene xong`, hasError: false, renderDone, isRunning };
  if (steps["video-plan"]?.status === "done") return { label: "Đã có video-plan", hasError: false, renderDone, isRunning };
  if (steps.audio?.status === "done") return { label: "Đã có audio", hasError: false, renderDone, isRunning };
  if (steps.plan?.status === "done") return { label: "Đã có content-plan", hasError: false, renderDone, isRunning };
  const running = Object.values(steps).find((s) => s.status === "running");
  if (running) return { label: `Đang chạy "${running.step}"`, hasError: false, renderDone, isRunning };
  return { label: "Chưa bắt đầu", hasError: false, renderDone, isRunning };
}

/** Persists which channel profile a project was created/run with, directly on
 *  job-status.json — the one piece of per-project state that survives regardless of
 *  HOW the user later navigates back into it (Batch.jsx's own "Mở project" button,
 *  the cross-project "Đang chạy nền" banner, a page reload...). Found live (user
 *  report, repeated): every other path relied on the CLIENT re-passing profileSlug
 *  through in-memory handoff state (App.jsx's handleCreated), which several
 *  navigation routes (RunningBanner's jump, History) never had it to begin with —
 *  and the one server-side fallback (video-plan.json's imageLibrary.profileSlug)
 *  doesn't exist yet for a project still sitting at content-plan. This makes the
 *  profile a durable fact about the project from the moment it's first known,
 *  independent of any one screen's local state. */
export function setProjectProfile(projectDir, profileSlug) {
  if (!profileSlug) return;
  const current = readJobStatus(projectDir);
  if (current.profileSlug === profileSlug) return;
  current.profileSlug = profileSlug;
  writeJobStatusFile(projectDir, current);
}

export function getEmitter(projectDir) {
  if (!emitters.has(projectDir)) emitters.set(projectDir, new EventEmitter().setMaxListeners(50));
  return emitters.get(projectDir);
}

const STATUS_TRANSITIONS = new Set(["running", "done", "error", "cancelled"]);
const MAX_EVENTS = 500;

/** Records one progress event for `step` (e.g. "plan", "audio", "scene:scene_01")
 *  into job-status.json and broadcasts it to any SSE listeners.
 *
 *  `steps[step]` stays a small, uniform lifecycle snapshot ({step, status, at,
 *  error?}), updated only on running/done/error transitions — NOT on arbitrary
 *  progress payloads, whose shape varies per task (agent tool-call events vs.
 *  TTS per-scene events vs. lint-retry events). Mixing those into `steps[step]` by
 *  object-spread was tried first and produced a garbled final snapshot (fields from
 *  unrelated event types bleeding into each other) — confirmed live while wiring up
 *  the API. The full heterogeneous trace instead goes into an append-only `events`
 *  array, capped at MAX_EVENTS. */
export function emitProgress(projectDir, event) {
  const full = { ...event, at: new Date().toISOString() };
  const current = readJobStatus(projectDir);
  current.steps ??= {};
  if (full.step && STATUS_TRANSITIONS.has(full.status)) {
    current.steps[full.step] = {
      step: full.step,
      status: full.status,
      at: full.at,
      ...(full.error ? { error: full.error } : {}),
      ...(full.usage ? { usage: full.usage } : {}),
    };
    // Running total across every step that reported DashScope usage — steps without
    // an LLM call (audio/render) never pass `usage`, so they don't contribute.
    if (full.usage) {
      current.totalUsage ??= { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 };
      current.totalUsage.promptTokens += full.usage.promptTokens ?? 0;
      current.totalUsage.completionTokens += full.usage.completionTokens ?? 0;
      current.totalUsage.totalTokens += full.usage.totalTokens ?? 0;
      current.totalUsage.apiCalls += full.usage.apiCalls ?? 0;
    }
  }
  current.events ??= [];
  current.events.push(full);
  if (current.events.length > MAX_EVENTS) current.events = current.events.slice(-MAX_EVENTS);
  current.updatedAt = full.at;
  writeJobStatusFile(projectDir, current);
  getEmitter(projectDir).emit("event", full);
  return full;
}

/** Runs `taskFn(onEvent)` as one tracked pipeline step: marks running → done/error,
 *  forwards any progress the task reports mid-flight (e.g. per-scene TTS progress).
 *
 *  Some tasks (scene-writer's runSceneWriter, hyperframes-cli's render) signal
 *  failure by resolving with `{ ok: false, ... }` instead of throwing — confirmed
 *  live via the API: a render/scene-writer failure would otherwise still land here
 *  as a resolved promise and get recorded as "done", hiding a real failure from
 *  job-status.json and any SSE listener. Treat `ok === false` on the resolved value
 *  as an error the same way a thrown exception is treated.
 */
/**
 * Marks any step still "running" as "error" — called once at server startup for
 * every known project. State lives entirely on disk (job-status.json), but a
 * "running" entry is really just "a task was in flight in SOME earlier process" —
 * if that process is gone (crashed, or the user restarted it to pick up a code
 * change, as documented in plan.md's timeout-fix section), nothing will ever call
 * emitProgress "done"/"error" for it again, since the in-memory work was lost with
 * the process. Confirmed live: a render stuck "running" for hours after a restart,
 * and the UI's own "hide the button while running" logic (Pipeline.jsx) then makes
 * it permanently unclickable — the user has no way to recover without this.
 */
export function reconcileInterruptedSteps(projectDir) {
  const current = readJobStatus(projectDir);
  let changed = false;
  for (const step of Object.values(current.steps ?? {})) {
    if (step.status === "running") {
      step.status = "error";
      step.error = "Bị gián đoạn do server khởi động lại giữa chừng — thử chạy lại bước này.";
      step.at = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) writeJobStatusFile(projectDir, current);
  return changed;
}

/** `taskFn(onEvent, signal)` — `signal` fires when `POST /projects/:id/cancel` is
 *  called for this exact `(projectDir, step)` while it's running (see
 *  cancel-registry.mjs). Every provider call downstream (chatCompletion, TTS
 *  synthesize, render's execFile, image generation) is expected to accept and honor
 *  this same signal so an abort actually stops in-flight work instead of just
 *  hiding it from the UI while the server keeps paying for it. */
export async function runStep(projectDir, step, taskFn) {
  emitProgress(projectDir, { step, status: "running" });
  const controller = new AbortController();
  registerCancellable(projectDir, step, controller);
  try {
    const result = await taskFn((partial) => emitProgress(projectDir, { step, status: "progress", ...partial }), controller.signal);
    if (result && typeof result === "object" && result.ok === false) {
      const err = new Error(result.error ?? `${step} failed`);
      err.usage = result.usage;
      throw err;
    }
    emitProgress(projectDir, { step, status: "done", usage: result?.usage ?? null });
    return result;
  } catch (err) {
    if (err instanceof CancelledError) {
      emitProgress(projectDir, { step, status: "cancelled", error: err.message, usage: err.usage ?? null });
      throw err;
    }
    // Agent tasks (content-planner/video-planner/scene-writer/root-composer) attach
    // `.usage` to thrown errors too (see run-agent.mjs) — a failed job still spent
    // real tokens getting there, and that cost should show up in totalUsage same as
    // a successful one, not silently vanish.
    emitProgress(projectDir, { step, status: "error", error: err.message, usage: err.usage ?? null });
    throw err;
  } finally {
    unregisterCancellable(projectDir, step);
  }
}
