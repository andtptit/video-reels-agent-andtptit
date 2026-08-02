/**
 * Central declared DashScope model tiers, mirrored manually against
 * web/src/components/Pipeline.jsx's EXPENSIVE_MODELS/CHEAP_MODELS (that list is for
 * UI dropdowns; this one drives server-side automatic fallback — see run-agent.mjs).
 * Only declared here because 2 real quota-exhaustion incidents happened live in one
 * session (qwen3.6-plus's free tier ran out mid-work, twice) and both times the fix
 * was "just pick a different model in the same tier" — worth automating instead of
 * requiring the user to notice the error and manually switch every time.
 */
export const EXPENSIVE_MODELS = ["qwen3.6-plus", "qwen3.5-plus", "qwen-plus-2025-04-28", "qwen-plus"];
export const CHEAP_MODELS = ["qwen3.7-flash", "qwen3.6-flash", "qwen-flash", "deepseek-v4-flash", "qwen3-vl-flash", "qwen-turbo"];

function tierFor(model) {
  if (EXPENSIVE_MODELS.includes(model)) return EXPENSIVE_MODELS;
  if (CHEAP_MODELS.includes(model)) return CHEAP_MODELS;
  return null;
}

/**
 * Next untried sibling model in the SAME tier as `model` — never crosses from
 * expensive to cheap or vice versa (that would silently trade off output quality
 * the user never agreed to). Returns null if `model` isn't in either declared tier,
 * or every sibling has already been tried.
 */
export function nextFallbackModel(model, excluded = []) {
  const tier = tierFor(model);
  if (!tier) return null;
  return tier.find((m) => m !== model && !excluded.includes(m)) ?? null;
}
