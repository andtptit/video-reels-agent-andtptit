/**
 * Vbee TTS provider — same interface as elevenlabs.mjs/edge-tts.mjs so
 * generate-audio.mjs can select it via TTS_PROVIDERS without touching the timing
 * math downstream. Defaults to Vbee's Batch API (mode:"async" + poll Get Request) —
 * confirmed live that the Realtime API (mode:"sync", would otherwise be a better fit
 * for this pipeline's short per-scene narration) returns `BAD_REQUEST "This feature
 * is not supported in user package"` on this account's plan tier. `preferRealtime`
 * opts back into Realtime for accounts whose plan does support it (still only for
 * narration ≤300 chars — Realtime hard-rejects anything longer); Batch has no such
 * length cap (100,000 chars) and works on every plan tier, so it's the safe default.
 *
 * Vbee's API returns audio only — no word-level timestamps in either response shape
 * (confirmed via api-docs.vbee.vn: Realtime returns raw audio bytes, Batch/Get-Request
 * only ever carries `audioLink`). Unlike elevenlabs.mjs/edge-tts.mjs, this provider
 * therefore runs local Whisper (same hyperframes-cli.mjs wrapper as
 * hyperframes-whisper.mjs) on the audio it just received, but ONLY for TIMING —
 * Whisper's own word recognition is discarded and replaced with the KNOWN `text`
 * this function was given (the exact string sent to Vbee), via
 * alignKnownTextToWhisperTiming() below. Confirmed live (user report): Whisper's
 * word BOUNDARIES land in the right place even when its recognized TEXT is wrong
 * ("chữ sai, timing đúng") — so borrowing only the timing and keeping the known
 * text eliminates mis-heard-word caption errors by construction, not by better
 * transcription accuracy.
 */
import { writeFileSync } from "fs";
import { transcribe as whisperTranscribe } from "../../tools/hyperframes-cli.mjs";
import { CancelledError } from "../../jobs/cancel-registry.mjs";

export const id = "vbee";

const API_BASE = "https://api.vbee.vn/v1/tts";
const REALTIME_MAX_CHARS = 300;
const BATCH_POLL_MS = 1500;
const BATCH_POLL_TIMEOUT_MS = 3 * 60 * 1000;

function authHeaders(appId, token) {
  return { Authorization: `Bearer ${token}`, "App-Id": appId, "Content-Type": "application/json" };
}

async function vbeeErrorFromResponse(res) {
  let body = null;
  try {
    body = await res.clone().json();
  } catch {
    /* not JSON — fall through to raw text below */
  }
  const msg = body?.error?.message || body?.message || (await res.text().catch(() => ""));
  return new Error(`Vbee TTS lỗi (${res.status}): ${msg || "không rõ nguyên nhân"}`);
}

async function synthesizeRealtime({ text, voiceCode, speed, outputFormat, appId, token, signal }) {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: authHeaders(appId, token),
    body: JSON.stringify({ text, mode: "sync", voiceCode, ...(speed ? { speed } : {}), outputFormat }),
    signal,
  });
  if (!res.ok) throw await vbeeErrorFromResponse(res);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("Vbee TTS (realtime) trả về audio rỗng");
  return buf;
}

// Batch API requires webhookUrl even though this backend has no public endpoint to
// receive it (local dev / not internet-exposed) — a syntactically valid but never-
// reached URL satisfies request validation; the result is fetched via polling Get
// Request below instead of waiting for the callback to arrive.
const UNUSED_WEBHOOK_URL = "https://example.com/vbee-webhook-unused";

async function synthesizeBatch({ text, voiceCode, speed, outputFormat, appId, token, signal }) {
  const startRes = await fetch(API_BASE, {
    method: "POST",
    headers: authHeaders(appId, token),
    body: JSON.stringify({ text, mode: "async", voiceCode, ...(speed ? { speed } : {}), outputFormat, webhookUrl: UNUSED_WEBHOOK_URL }),
    signal,
  });
  if (!startRes.ok) throw await vbeeErrorFromResponse(startRes);
  const { requestId } = await startRes.json();
  if (!requestId) throw new Error("Vbee TTS (batch) không trả về requestId");

  const deadline = Date.now() + BATCH_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    await new Promise((r) => setTimeout(r, BATCH_POLL_MS));
    const statusRes = await fetch(`${API_BASE}/requests/${requestId}`, { headers: authHeaders(appId, token), signal });
    if (!statusRes.ok) throw await vbeeErrorFromResponse(statusRes);
    const data = await statusRes.json();
    if (data.status === "COMPLETED") {
      const audioRes = await fetch(data.audioLink, { signal });
      if (!audioRes.ok) throw new Error(`Vbee TTS: tải audioLink thất bại (${audioRes.status})`);
      return Buffer.from(await audioRes.arrayBuffer());
    }
    if (data.status === "FAILED") throw new Error(`Vbee TTS (batch) thất bại: ${data.error?.message || "không rõ nguyên nhân"}`);
  }
  throw new Error("Vbee TTS (batch): quá thời gian chờ xử lý (3 phút)");
}

// Matches elevenlabs.mjs/edge-tts.mjs's word_timestamps convention: punctuation is
// never part of a word token (ElevenLabs' extractWordTimestamps treats it purely as
// a delimiter). knownWords here comes from a plain whitespace split of the sent
// text, so punctuation stays attached ("hàng," "bộ.") unless stripped here —
// left attached would render on screen via karaoke-captions.mjs's escapeHtml(w.word),
// visibly inconsistent with every other TTS provider's captions.
function stripEdgePunctuation(s) {
  return s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function normalizeToken(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

// Same bounded-lookahead merge/split resync as caption-chunks.mjs's
// alignNarrationToWords (a TTS engine occasionally speaks 2 words as 1 token or
// vice versa), extended to never permanently give up: on an unresolvable mismatch
// it assumes a plain substitution (1 known word ↔ 1 Whisper token, different text)
// instead of stopping, so a single mis-heard word can't desync the rest of the
// scene. Any known word still without timing after the walk (Whisper decoded fewer
// tokens than the sentence has words, or nothing resynced at all) is interpolated
// from its nearest resolved neighbors — captions must cover every word that was
// actually sent to Vbee, not just the part Whisper's timing could be matched to.
const RESYNC_LOOKAHEAD = 3;

export function alignKnownTextToWhisperTiming(text, whisperWords) {
  const knownWords = String(text ?? "").split(/\s+/).filter(Boolean);
  if (!knownWords.length) return [];
  if (!whisperWords?.length) {
    throw new Error("Vbee TTS: Whisper không nhận diện được từ nào trong audio vừa sinh — không thể lấy timing.");
  }

  const timing = new Array(knownWords.length).fill(null);
  let i = 0;
  let j = 0;
  while (i < knownWords.length && j < whisperWords.length) {
    const nWord = normalizeToken(knownWords[i]);
    const tWord = normalizeToken(whisperWords[j].word);

    if (nWord === tWord) {
      timing[i] = { start: whisperWords[j].start, end: whisperWords[j].end };
      i++;
      j++;
      continue;
    }

    let merged = "";
    let mergeSpan = 0;
    for (let k = 0; k < RESYNC_LOOKAHEAD && i + k < knownWords.length; k++) {
      merged += normalizeToken(knownWords[i + k]);
      if (merged === tWord) {
        mergeSpan = k + 1;
        break;
      }
    }
    if (mergeSpan) {
      // Found live (user report): giving every merged known word the SAME full
      // [start,end] slot (identical to whisperWords[j]'s own timing) produced two
      // DIFFERENT words with byte-identical timestamps whenever a merge was
      // detected — downstream, caption-chunks.mjs's sentence-boundary split then
      // created two chunks starting at the exact same instant, tripping
      // hyperframes' overlapping_clips_same_track lint error. Split the slot's
      // duration evenly across the merged words instead — still approximate (the
      // real per-word boundary within a single Whisper token is unknown), but
      // guarantees every known word gets a distinct, non-overlapping window.
      const slotStart = whisperWords[j].start;
      const slotDur = (whisperWords[j].end - slotStart) / mergeSpan;
      for (let m = 0; m < mergeSpan; m++) {
        timing[i + m] = { start: slotStart + m * slotDur, end: slotStart + (m + 1) * slotDur };
      }
      i += mergeSpan;
      j += 1;
      continue;
    }

    let split = "";
    let splitSpan = 0;
    for (let k = 0; k < RESYNC_LOOKAHEAD && j + k < whisperWords.length; k++) {
      split += normalizeToken(whisperWords[j + k].word);
      if (split === nWord) {
        splitSpan = k + 1;
        break;
      }
    }
    if (splitSpan) {
      timing[i] = { start: whisperWords[j].start, end: whisperWords[j + splitSpan - 1].end };
      i += 1;
      j += splitSpan;
      continue;
    }

    // Neither merge nor split resynced within lookahead — assume Whisper simply
    // misheard this one word (different text, same time slot) and keep both
    // pointers moving together so the mismatch can't cascade into the rest of
    // the scene.
    timing[i] = { start: whisperWords[j].start, end: whisperWords[j].end };
    i++;
    j++;
  }

  for (let idx = 0; idx < timing.length; idx++) {
    if (timing[idx]) continue;
    let left = idx - 1;
    while (left >= 0 && !timing[left]) left--;
    let right = idx + 1;
    while (right < timing.length && !timing[right]) right++;
    const leftEnd = left >= 0 ? timing[left].end : 0;
    const rightStart = right < timing.length ? timing[right].start : leftEnd + 0.3;
    const span = Math.max(rightStart - leftEnd, 0.05);
    const gapCount = right - left;
    const slot = idx - left;
    timing[idx] = { start: leftEnd + span * ((slot - 1) / gapCount), end: leftEnd + span * (slot / gapCount) };
  }

  return knownWords.map((word, idx) => ({ word: stripEdgePunctuation(word) || word, start: timing[idx].start, end: timing[idx].end }));
}

export async function synthesize({
  text,
  destPath,
  appId = process.env.VBEE_APP_ID,
  token = process.env.VBEE_TOKEN,
  voiceId = process.env.VBEE_VOICE_CODE,
  rate,
  language = "vi",
  whisperModel = "small",
  preferRealtime = process.env.VBEE_PREFER_REALTIME === "true",
  signal,
}) {
  if (!appId || !token) throw new Error("Missing VBEE_APP_ID/VBEE_TOKEN");
  if (!voiceId) throw new Error("Missing VBEE_VOICE_CODE (hoặc truyền ttsVoice) — chưa biết dùng giọng nào");
  if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();

  // Confirmed live (user report): Vbee's voice reads "—" (em-dash, common in
  // LLM-written narration for a dramatic beat) straight through with no pause at all,
  // while ";" DOES trigger a pause on this account's configured voice — replaced here
  // (not via prompt instructions to the LLM) because a text-level swap is guaranteed,
  // where telling the LLM "never use —" is not (same "code owns mechanical
  // transforms, never trust the LLM to comply" reasoning as root-composer.mjs/
  // script-scene-cutter.mjs elsewhere in this codebase). Scoped to Vbee specifically
  // — this is Vbee's own pause quirk + this account's own ";" pause config, not
  // something ElevenLabs/edge-tts need. `normalizedText` (not the original `text`) is
  // what's actually sent AND what alignKnownTextToWhisperTiming below treats as
  // "known text", so captions/timing stay consistent with what was really spoken.
  const normalizedText = text.replace(/—/g, ";");

  const opts = { text: normalizedText, voiceCode: voiceId, speed: rate, outputFormat: "mp3", appId, token, signal };
  const buf = preferRealtime && text.length <= REALTIME_MAX_CHARS ? await synthesizeRealtime(opts) : await synthesizeBatch(opts);
  writeFileSync(destPath, buf);

  const { words: rawWords } = await whisperTranscribe(destPath, { engine: "whisper", model: whisperModel, language, signal });
  const whisperWords = rawWords.map((w) => ({ word: w.text ?? w.word, start: w.start, end: w.end }));
  const wordTimestamps = alignKnownTextToWhisperTiming(normalizedText, whisperWords);
  const voDuration = wordTimestamps.at(-1)?.end ?? 0;

  return { wordTimestamps, voDuration, audioBytes: buf.length };
}
