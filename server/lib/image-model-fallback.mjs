/**
 * Free-quota-milking fallback chain for DashScope image models — user has ~1 month
 * left on a bunch of free-tier image models (confirmed live via DashScope's own
 * "Stop-on-Exhaust" console setting) and wants generation to auto-advance through an
 * ordered list instead of hand-editing a profile's `imgModel` every time one model
 * runs dry. Cheapest/already-proven-stable models first, newest/heaviest last (user's
 * own ordering).
 *
 * Deliberately does NOT try to detect "this specific error means quota exhausted" —
 * every one of the 13 models in the default chain was confirmed live to generate a
 * real image successfully (see chat history), so ANY failure after a couple retries
 * is treated the same way: advance to the next model. Simpler and more robust than
 * parsing DashScope's error text, at the cost of also advancing past a model on a
 * one-off transient error — acceptable for a short-lived experimentation tool with a
 * short, hand-curated model list (not a general-purpose retry framework).
 *
 * State is a single JSON file, no locking — two scenes rendering in parallel (this
 * workspace's own parallel-agents-per-scene convention, see CLAUDE.md step 5) could
 * race and double-advance the pointer under real concurrent failures. Harmless here:
 * worst case is skipping one extra still-good model, not a correctness bug — not
 * worth a lock file for a 1-month personal-scale tool.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const CONFIG_PATH = join(import.meta.dirname, "..", "config", "image-model-fallback.json");
const STATE_PATH = join(import.meta.dirname, "..", "state", "image-model-quota.json");

// Mirrors DEFAULT_IMAGE_MODEL in dashscope-image.mjs — used only if the config file
// is ever missing/unreadable, so a broken/absent config can't take image generation
// down entirely.
const FALLBACK_CHAIN_IF_CONFIG_MISSING = ["wan2.6-image"];

function readChain() {
  try {
    const { chain } = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return Array.isArray(chain) && chain.length ? chain : FALLBACK_CHAIN_IF_CONFIG_MISSING;
  } catch {
    return FALLBACK_CHAIN_IF_CONFIG_MISSING;
  }
}

function readState() {
  if (!existsSync(STATE_PATH)) return { currentIndex: 0, history: [] };
  try {
    const state = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    return { currentIndex: state.currentIndex ?? 0, history: state.history ?? [] };
  } catch {
    return { currentIndex: 0, history: [] };
  }
}

function writeState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/** @returns {string} the model to use right now — last entry in the chain if everything before it has been marked exhausted. */
export function getActiveModel() {
  const chain = readChain();
  const { currentIndex } = readState();
  return chain[Math.min(currentIndex, chain.length - 1)];
}

/**
 * Call after `failedModel` has failed enough times to give up on it for now.
 * Only advances the pointer if `failedModel` is still the active model (avoids a
 * late/duplicate call from an already-superseded attempt re-advancing past a model
 * that's actually fine).
 * @returns {string|null} the next model to try, or null if the whole chain is exhausted.
 */
export function advanceToNextModel(failedModel, errorMessage) {
  const chain = readChain();
  const state = readState();
  const active = chain[Math.min(state.currentIndex, chain.length - 1)];
  if (active !== failedModel) return active; // someone already advanced past this one

  state.history.push({ model: failedModel, failedAt: new Date().toISOString(), error: String(errorMessage ?? "").slice(0, 500) });
  if (state.currentIndex >= chain.length - 1) {
    writeState(state); // still record the failure even though there's nowhere left to go
    return null;
  }
  state.currentIndex += 1;
  writeState(state);
  return chain[state.currentIndex];
}

/** Manual reset for a new billing month / after quota refills — clears the pointer back to the start of the chain. */
export function resetFallback() {
  writeState({ currentIndex: 0, history: [] });
}
