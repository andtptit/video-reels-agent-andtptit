/**
 * DashScope wan2.6-image provider — text-to-image via the NATIVE multimodal-generation
 * endpoint (different from `providers/llm/dashscope.mjs`, which uses the
 * OpenAI-compatible chat endpoint; image generation has no OpenAI-compatible route).
 *
 * Confirmed live, endpoint discovered by trial + real error messages, not guessed:
 * - Plain text-to-image (no input image) requires `enable_interleave: true`.
 * - `enable_interleave: true` forces streaming — a non-streaming request is rejected
 *   outright ("stream=False is not supported"). The model streams commentary TEXT
 *   chunks first, then the actual image chunk — must consume the whole SSE stream
 *   and take the LAST `{type:"image"}` part, not the first response.
 * - `size` must be "<number>*<number>"; despite the API's own error text calling it
 *   "H*W format", the FIRST number came out as the output PNG's WIDTH in every test
 *   here (confirmed with `file` on the downloaded image) — so treat it as "W*H" in
 *   practice, not the documented "H*W".
 * - Total pixels must be within [589824, 1638400] when enable_interleave is true.
 *   SIZE_TABLES below hits that budget at exact 9:16 / 16:9 ratios — but the allowed
 *   values are PER MODEL FAMILY, not universal (see SIZE_TABLES' own comment).
 * - Returned image URLs are OSS-signed and expire in 24h — download into the
 *   project's assets/ immediately; never persist the URL itself.
 */
import { writeFileSync, existsSync, statSync } from "fs";
import { CancelledError } from "../../jobs/cancel-registry.mjs";
import { getActiveModel, advanceToNextModel } from "../../lib/image-model-fallback.mjs";

const ENDPOINT = "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

// The "Wan-T2I" model family (confirmed live, see chat history) is NOT reachable via
// the multimodal-generation endpoint above at all — it lives on a separate, older,
// task-based synthesis API under a per-account Workspace subdomain, discovered from a
// real "View Code" sample after the multimodal-generation endpoint failed for these
// models with an unrelated-sounding "url error, please check url". Needs
// DASHSCOPE_WORKSPACE_ID (the account's Workspace ID, e.g. "ws-xxxx" — found in the
// DashScope console, not the same thing as DASHSCOPE_API_KEY).
const CLASSIC_ENDPOINT_MODELS = new Set([
  "wan2.5-t2i-preview",
  "wan2.2-t2i-plus",
  "wan2.2-t2i-flash",
  "wan2.1-t2i-plus",
  "wan2.1-t2i-turbo",
]);

// Overridable via .env (DASHSCOPE_MODEL_IMAGE), same pattern as DASHSCOPE_MODEL /
// DASHSCOPE_MODEL_CHEAP in run-agent.mjs — lets a future/alternate image model be
// swapped in for testing without editing code.
const DEFAULT_IMAGE_MODEL = process.env.DASHSCOPE_MODEL_IMAGE || "wan2.6-image";

// Each model family enforces its OWN fixed set of allowed `size` values — confirmed
// live: wan2.6-image accepts arbitrary sizes within a pixel-count budget, but
// requesting a wan2.6-image-shaped size ("864*1536") against qwen-image failed with
// "The size does not match the allowed size 1664*928,1472*1104,1328*1328,1104*1472,928*1664".
// z-image-turbo and qwen-image-2.0 were confirmed live to accept qwen-image's 9:16/16:9
// values too, so they share qwen-image's table rather than each getting probed
// separately — narrow the assumption if a future model in this family rejects it.
const SIZE_TABLES = {
  // "1:1" for wan2.6-image: 1024*1024 = 1,048,576px, comfortably inside the
  // documented [589824, 1638400] pixel budget (see file header) — this model has no
  // fixed size table (accepts arbitrary sizes within budget), unlike the qwen-image
  // family below.
  "wan2.6-image": { "9:16": "864*1536", "16:9": "1536*864", "1:1": "1024*1024" },
  // "1:1" for the qwen-image family: 1328*1328 is one of the exact values the API
  // itself listed as allowed (see SIZE_TABLES comment above / dashscope-image.mjs
  // header), not guessed.
  "qwen-image": { "9:16": "928*1664", "16:9": "1664*928", "1:1": "1328*1328" },
  "qwen-image-2.0": { "9:16": "928*1664", "16:9": "1664*928", "1:1": "1328*1328" },
  "z-image-turbo": { "9:16": "928*1664", "16:9": "1664*928", "1:1": "1328*1328" },
  // qwen-image-plus/2.0-pro/3.0-pro/3.0 confirmed live to accept qwen-image's own
  // size table too (same family) — not independently probed for a wider table.
  "qwen-image-plus": { "9:16": "928*1664", "16:9": "1664*928", "1:1": "1328*1328" },
  "qwen-image-2.0-pro": { "9:16": "928*1664", "16:9": "1664*928", "1:1": "1328*1328" },
  "qwen-image-3.0-pro": { "9:16": "928*1664", "16:9": "1664*928", "1:1": "1328*1328" },
  "qwen-image-3.0": { "9:16": "928*1664", "16:9": "1664*928", "1:1": "1328*1328" },
  // Wan-T2I family (classic endpoint, see CLASSIC_ENDPOINT_MODELS) — confirmed live
  // that wan2.6-image's own "9:16"/"16:9" values are also accepted here (arbitrary
  // size within a pixel budget, not qwen's fixed table); "1:1" reuses wan2.6-image's
  // value too since the same flexible-size behavior was observed, not independently
  // probed for that ratio specifically.
  "wan2.5-t2i-preview": { "9:16": "864*1536", "16:9": "1536*864", "1:1": "1024*1024" },
  "wan2.2-t2i-plus": { "9:16": "864*1536", "16:9": "1536*864", "1:1": "1024*1024" },
  "wan2.2-t2i-flash": { "9:16": "864*1536", "16:9": "1536*864", "1:1": "1024*1024" },
  "wan2.1-t2i-plus": { "9:16": "864*1536", "16:9": "1536*864", "1:1": "1024*1024" },
  "wan2.1-t2i-turbo": { "9:16": "864*1536", "16:9": "1536*864", "1:1": "1024*1024" },
};
const DEFAULT_SIZE_TABLE = SIZE_TABLES["wan2.6-image"];

// Confirmed live: the positive prompt saying "no watermark, no text" is not reliably
// enough on its own — a real generation still had a small stock-photo-style watermark
// in the corner. `negative_prompt` is a separate, more effective lever the API exposes;
// always send it unless the caller has a reason to override.
const DEFAULT_NEGATIVE_PROMPT = "text, words, letters, watermark, logo, signature, caption, subtitle";

/**
 * Classic task-based text2image/image-synthesis API — the ONLY endpoint the Wan-T2I
 * family (see CLASSIC_ENDPOINT_MODELS) is reachable through; confirmed live via a real
 * "View Code" sample from the DashScope console after the multimodal-generation
 * endpoint below rejected these models with an unrelated "url error, please check
 * url". Submit-then-poll, unlike the SSE stream generateImage() otherwise uses.
 */
async function synthesizeClassic({ prompt, size, model, apiKey, workspaceId, timeoutMs, signal }) {
  if (!workspaceId) throw new Error("Missing DASHSCOPE_WORKSPACE_ID (required for Wan-T2I models — find it in the DashScope console)");
  const base = `https://${workspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1`;

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
  try {
    let startRes;
    try {
      startRes = await fetch(`${base}/services/aigc/text2image/image-synthesis`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-DashScope-Async": "enable" },
        body: JSON.stringify({ model, input: { prompt }, parameters: { size, n: 1 } }),
        signal: combinedSignal,
      });
    } catch (err) {
      if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
      throw new Error(`${model} request failed: ${err.message}`, { cause: err });
    }
    if (!startRes.ok) throw new Error(`${model} request failed (${startRes.status}): ${await startRes.text()}`);
    const startBody = await startRes.json();
    const taskId = startBody.output?.task_id;
    if (!taskId) throw new Error(`${model}: no task_id returned (${JSON.stringify(startBody)})`);

    while (true) {
      if (combinedSignal.aborted) throw signal?.reason instanceof CancelledError ? signal.reason : new CancelledError();
      await new Promise((r) => setTimeout(r, 2000));
      const pollRes = await fetch(`${base}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: combinedSignal });
      if (!pollRes.ok) throw new Error(`${model}: task poll failed (${pollRes.status}): ${await pollRes.text()}`);
      const pollBody = await pollRes.json();
      const status = pollBody.output?.task_status;
      if (status === "SUCCEEDED") {
        const url = pollBody.output?.results?.[0]?.url;
        if (!url) throw new Error(`${model}: task succeeded but returned no image url`);
        return { imageUrl: url };
      }
      if (status === "FAILED") throw new Error(`${model}: task failed — ${JSON.stringify(pollBody.output)}`);
      // else PENDING/RUNNING — keep polling until timeoutMs (via combinedSignal) trips.
    }
  } finally {
    clearTimeout(timer);
  }
}

/** @returns {Promise<{imageUrl: string}>} a 24h-expiring OSS URL — download it immediately. */
export async function generateImage({
  prompt,
  format = "9:16",
  negativePrompt = DEFAULT_NEGATIVE_PROMPT,
  apiKey = process.env.DASHSCOPE_API_KEY,
  workspaceId = process.env.DASHSCOPE_WORKSPACE_ID,
  timeoutMs = 120_000,
  model = DEFAULT_IMAGE_MODEL,
  signal, // external cancel signal, see jobs/cancel-registry.mjs
}) {
  if (!apiKey) throw new Error("Missing DASHSCOPE_API_KEY");
  const sizeTable = SIZE_TABLES[model] ?? DEFAULT_SIZE_TABLE;
  const size = sizeTable[format] ?? sizeTable["9:16"];

  if (CLASSIC_ENDPOINT_MODELS.has(model)) {
    return synthesizeClassic({ prompt, size, model, apiKey, workspaceId, timeoutMs, signal });
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-DashScope-SSE": "enable" },
      body: JSON.stringify({
        model,
        input: { messages: [{ role: "user", content: [{ text: prompt }] }] },
        parameters: {
          size,
          n: 1,
          watermark: false,
          enable_interleave: true,
          stream: true,
          negative_prompt: negativePrompt,
        },
      }),
      signal: combinedSignal,
    });
  } catch (err) {
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    throw new Error(`wan2.6-image request failed: ${err.message}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`wan2.6-image request failed (${res.status}): ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let imageUrl = null;
  let errorMessage = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        let parsed;
        try {
          parsed = JSON.parse(line.slice(5));
        } catch {
          continue;
        }
        if (parsed.code) {
          errorMessage = parsed.message; // SSE error event, e.g. event:error
          continue;
        }
        const content = parsed.output?.choices?.[0]?.message?.content;
        if (Array.isArray(content)) {
          for (const part of content) {
            // wan2.6-image's stream parts carry `type:"image"`; confirmed live that
            // qwen-image/qwen-image-2.0/z-image-turbo omit `type` entirely on their
            // image part — requiring it here silently dropped a real, successful
            // image URL and made those 3 models look broken when they weren't.
            if (part.image) imageUrl = part.image;
          }
        }
      }
    }
  } catch (err) {
    // Aborting `combinedSignal` mid-stream (fetch's signal reaches into the response
    // body reader too) rejects reader.read() — re-throw as CancelledError so callers
    // don't mistake a deliberate Huỷ for a genuine stream error.
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    throw err;
  }

  if (!imageUrl) {
    throw new Error(`wan2.6-image returned no image${errorMessage ? `: ${errorMessage}` : " (unknown reason)"}`);
  }
  return { imageUrl };
}

// Retries the SAME model this many times (tolerates a one-off transient error) before
// giving up on it and advancing the fallback chain — only applies in auto mode (no
// explicit `model` passed in), see generateAndSaveImage below.
const MAX_ATTEMPTS_PER_MODEL = 2;

/**
 * Generates + immediately downloads into destPath (URL expires in 24h).
 *
 * Skips generation entirely if `destPath` already exists — same "already have it,
 * don't pay for it again" pattern generate-audio.mjs uses for TTS. Missing here
 * before was a real cost bug: re-running sub-scene-writer for one scene (e.g. just to
 * pick up an unrelated caption/font fix) silently re-billed a fresh wan2.6-image call
 * even though the existing image was still perfectly usable.
 *
 * `model` explicitly passed (a profile's `imgModel` set) is pinned — never falls back,
 * a caller who named a specific model wants exactly that one. `model` omitted (empty
 * `imgModel`) uses the free-quota fallback chain (lib/image-model-fallback.mjs):
 * retries the current chain model up to MAX_ATTEMPTS_PER_MODEL times, then advances to
 * the next model in the chain and keeps going until one succeeds or the chain runs out.
 */
export async function generateAndSaveImage({ prompt, format, negativePrompt, destPath, apiKey, model, signal }) {
  if (existsSync(destPath)) {
    return { destPath, bytes: statSync(destPath).size, skipped: true };
  }

  const autoMode = !model;
  let currentModel = model || getActiveModel();
  let imageUrl;
  let lastError;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let attemptsLeft = autoMode ? MAX_ATTEMPTS_PER_MODEL : 1;
    let succeeded = false;
    while (attemptsLeft > 0) {
      try {
        ({ imageUrl } = await generateImage({ prompt, format, negativePrompt, apiKey, signal, model: currentModel }));
        succeeded = true;
        break;
      } catch (err) {
        if (err instanceof CancelledError) throw err; // deliberate cancel — never retry/advance
        lastError = err;
        attemptsLeft--;
      }
    }
    if (succeeded) break;
    if (!autoMode) throw lastError;
    const next = advanceToNextModel(currentModel, lastError?.message);
    if (!next) {
      throw new Error(`Toàn bộ chain fallback model ảnh đã hết quota/lỗi (dừng ở "${currentModel}"): ${lastError?.message}`);
    }
    currentModel = next;
  }

  let res;
  try {
    res = await fetch(imageUrl, { signal });
  } catch (err) {
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    throw err;
  }
  if (!res.ok) throw new Error(`Failed to download generated image (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buf);
  return { destPath, bytes: buf.length, skipped: false };
}
