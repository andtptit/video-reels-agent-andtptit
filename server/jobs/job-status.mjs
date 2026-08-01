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

export function getEmitter(projectDir) {
  if (!emitters.has(projectDir)) emitters.set(projectDir, new EventEmitter().setMaxListeners(50));
  return emitters.get(projectDir);
}

const STATUS_TRANSITIONS = new Set(["running", "done", "error"]);
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
export async function runStep(projectDir, step, taskFn) {
  emitProgress(projectDir, { step, status: "running" });
  try {
    const result = await taskFn((partial) => emitProgress(projectDir, { step, status: "progress", ...partial }));
    if (result && typeof result === "object" && result.ok === false) {
      const err = new Error(result.error ?? `${step} failed`);
      err.usage = result.usage;
      throw err;
    }
    emitProgress(projectDir, { step, status: "done", usage: result?.usage ?? null });
    return result;
  } catch (err) {
    // Agent tasks (content-planner/video-planner/scene-writer/root-composer) attach
    // `.usage` to thrown errors too (see run-agent.mjs) — a failed job still spent
    // real tokens getting there, and that cost should show up in totalUsage same as
    // a successful one, not silently vanish.
    emitProgress(projectDir, { step, status: "error", error: err.message, usage: err.usage ?? null });
    throw err;
  }
}
