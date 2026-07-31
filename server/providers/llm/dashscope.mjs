/**
 * DashScope (Qwen) chat completions via the OpenAI-compatible endpoint — confirmed
 * working in this repo with `qwen-turbo` (plain chat, 200) and `qwen-plus`
 * (tool_calls, 200) against the international endpoint.
 */
export const id = "dashscope";

const ENDPOINT =
  process.env.DASHSCOPE_ENDPOINT ||
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";

function isTransient(err) {
  return err.name === "AbortError" || ["UND_ERR_HEADERS_TIMEOUT", "ECONNRESET", "ETIMEDOUT"].includes(err.cause?.code);
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
  timeoutMs = 90_000,
  retries = 2,
}) {
  if (!apiKey) throw new Error("Missing DASHSCOPE_API_KEY");

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, ...(tools ? { tools } : {}) }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`DashScope chat completion failed (${res.status}): ${await res.text()}`);
      }
      return await res.json();
    } catch (err) {
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
