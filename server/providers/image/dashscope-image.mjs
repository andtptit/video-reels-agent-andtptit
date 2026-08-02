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

const ENDPOINT = "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

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
  "wan2.6-image": { "9:16": "864*1536", "16:9": "1536*864" },
  "qwen-image": { "9:16": "928*1664", "16:9": "1664*928" },
  "qwen-image-2.0": { "9:16": "928*1664", "16:9": "1664*928" },
  "z-image-turbo": { "9:16": "928*1664", "16:9": "1664*928" },
};
const DEFAULT_SIZE_TABLE = SIZE_TABLES["wan2.6-image"];

// Confirmed live: the positive prompt saying "no watermark, no text" is not reliably
// enough on its own — a real generation still had a small stock-photo-style watermark
// in the corner. `negative_prompt` is a separate, more effective lever the API exposes;
// always send it unless the caller has a reason to override.
const DEFAULT_NEGATIVE_PROMPT = "text, words, letters, watermark, logo, signature, caption, subtitle";

/** @returns {Promise<{imageUrl: string}>} a 24h-expiring OSS URL — download it immediately. */
export async function generateImage({
  prompt,
  format = "9:16",
  negativePrompt = DEFAULT_NEGATIVE_PROMPT,
  apiKey = process.env.DASHSCOPE_API_KEY,
  timeoutMs = 120_000,
  model = DEFAULT_IMAGE_MODEL,
}) {
  if (!apiKey) throw new Error("Missing DASHSCOPE_API_KEY");
  const sizeTable = SIZE_TABLES[model] ?? DEFAULT_SIZE_TABLE;
  const size = sizeTable[format] ?? sizeTable["9:16"];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      signal: controller.signal,
    });
  } catch (err) {
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

  if (!imageUrl) {
    throw new Error(`wan2.6-image returned no image${errorMessage ? `: ${errorMessage}` : " (unknown reason)"}`);
  }
  return { imageUrl };
}

/**
 * Generates + immediately downloads into destPath (URL expires in 24h).
 *
 * Skips generation entirely if `destPath` already exists — same "already have it,
 * don't pay for it again" pattern generate-audio.mjs uses for TTS. Missing here
 * before was a real cost bug: re-running sub-scene-writer for one scene (e.g. just to
 * pick up an unrelated caption/font fix) silently re-billed a fresh wan2.6-image call
 * even though the existing image was still perfectly usable.
 */
export async function generateAndSaveImage({ prompt, format, negativePrompt, destPath, apiKey, model }) {
  if (existsSync(destPath)) {
    return { destPath, bytes: statSync(destPath).size, skipped: true };
  }
  const { imageUrl } = await generateImage({ prompt, format, negativePrompt, apiKey, ...(model ? { model } : {}) });
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to download generated image (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buf);
  return { destPath, bytes: buf.length, skipped: false };
}
