/**
 * In-process registry of cancellable jobs — one AbortController per currently-running
 * `(projectDir, step)` pair. `runStep` (job-status.mjs) registers/unregisters around
 * every step it runs; `routes.mjs`'s `POST /projects/:id/cancel` looks a job up here
 * and aborts it.
 *
 * `CancelledError` exists so every layer that wraps a call in retry logic
 * (dashscope.mjs's transient-failure retry, generate-audio.mjs's TTS retry) can tell
 * "the user deliberately cancelled this" apart from "the network hiccuped" — without
 * that distinction, clicking Huỷ would just get silently retried 1-2 more times
 * before actually stopping, which is exactly the wrong behavior for a cancel button.
 */
export class CancelledError extends Error {
  constructor(message = "Đã huỷ theo yêu cầu") {
    super(message);
    this.name = "CancelledError";
  }
}

const registry = new Map(); // `${projectDir}::${step}` -> AbortController

function key(projectDir, step) {
  return `${projectDir}::${step}`;
}

export function registerCancellable(projectDir, step, controller) {
  registry.set(key(projectDir, step), controller);
}

export function unregisterCancellable(projectDir, step) {
  registry.delete(key(projectDir, step));
}

/** @returns {boolean} true if a running job was found and aborted, false if there was nothing to cancel. */
export function cancelStep(projectDir, step) {
  const controller = registry.get(key(projectDir, step));
  if (!controller) return false;
  controller.abort(new CancelledError());
  return true;
}
