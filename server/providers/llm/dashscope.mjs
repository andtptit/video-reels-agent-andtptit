/**
 * DashScope (Qwen) chat completions via the OpenAI-compatible endpoint — confirmed
 * working in this repo against the international endpoint with:
 *   - `qwen-plus`: plain chat + tool_calls (200)
 *   - `qwen-turbo`: plain chat (200) AND tool_calls (200, confirmed later — returns
 *     correctly structured tool_calls with valid JSON arguments) — now the default
 *     for scene-writer.mjs/root-composer.mjs (see run-agent.mjs's CHEAP_MODEL) since
 *     those run once per scene and don't need qwen-plus's extra reasoning quality.
 */
import { CancelledError } from "../../jobs/cancel-registry.mjs";

export const id = "dashscope";

const ENDPOINT =
  process.env.DASHSCOPE_ENDPOINT ||
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";

function isTransient(err) {
  return err.name === "AbortError" || ["UND_ERR_HEADERS_TIMEOUT", "ECONNRESET", "ETIMEDOUT"].includes(err.cause?.code);
}

// Confirmed live (twice, same session): a model's free-tier quota runs out mid-work
// with a 403 `AllocationQuota.FreeTierOnly` (message body embeds the real DashScope
// error JSON, quoted inside our own Error's message — see the throw below), and
// separately DashScope can 429 on burst rate limits. Both are per-MODEL, not
// account-wide — confirmed by observation: switching qwen3.6-plus -> qwen-plus-2025-
// 04-28 immediately worked with zero other changes. NOT retryable by waiting
// (isTransient's job); the fix is picking a different model, see
// lib/models.mjs's nextFallbackModel, used by run-agent.mjs.
export function isQuotaOrRateLimitError(err) {
  const msg = err?.message ?? "";
  return /\(429\)/.test(msg) || /quota|throttl/i.test(msg);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Long system prompts (full SKILL.md files) + occasional slow upstream responses
 * can exceed undici's default headers timeout and crash the whole process with an
 * uncaught HeadersTimeoutError if left unhandled — seen live during scene-writer's
 * lint auto-fix retry. Bound every call with an explicit timeout and retry
 * transient failures a couple of times before giving up.
 */
export async function chatCompletion({
  model = "qwen-plus",
  messages,
  tools,
  apiKey = process.env.DASHSCOPE_API_KEY,
  timeoutMs = 180_000,
  retries = 2,
  signal, // external cancel signal (see jobs/cancel-registry.mjs) — merged with our
  // own timeout controller below. Must NOT go through the transient-retry path: a
  // deliberate user cancel and a bare `AbortError` are both "AbortError" by name, but
  // treating cancel as retryable would silently keep calling DashScope 1-2 more times
  // after the user clicked Huỷ, which defeats the whole point of that button.
}) {
  if (!apiKey) throw new Error("Missing DASHSCOPE_API_KEY");

  for (let attempt = 0; ; attempt++) {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, ...(tools ? { tools } : {}) }),
        signal: combinedSignal,
      });
      if (!res.ok) {
        throw new Error(`DashScope chat completion failed (${res.status}): ${await res.text()}`);
      }
      return await res.json();
    } catch (err) {
      if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
      const retryable = err.name === "AbortError" || isTransient(err);
      if (!retryable || attempt >= retries) {
        throw new Error(`DashScope chat completion failed after ${attempt + 1} attempt(s): ${err.message}`, { cause: err });
      }
      await sleep(1000 * 2 ** attempt); // 1s, 2s backoff
    } finally {
      clearTimeout(timer);
    }
  }
}
