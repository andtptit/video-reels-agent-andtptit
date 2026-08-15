/**
 * Facebook Graph API — publish a rendered video as a Page's Reel. Official 3-phase
 * flow (Meta for Developers, Graph API v25.0, "Reels Publishing API"):
 *   1. start  — POST /{page-id}/video_reels → { video_id, upload_url }
 *   2. upload — POST {upload_url} (binary body, `offset`/`file_size` headers)
 *   3. finish — POST /{page-id}/video_reels (video_id, description, video_state)
 * then poll GET /{video_id}?fields=status until Facebook's own processing finishes.
 *
 * v1 uploads the WHOLE file in one POST (not chunked/resumable) — renders in this
 * workspace run ~20-50MB (see a prior session's real render log, "22MB render"), light
 * enough for a single request. `offset`/`file_size` headers are still sent exactly as
 * the resumable protocol expects, so chunked retry can be added later without a
 * protocol change, but v1 deliberately doesn't implement resume-on-failure.
 */
import { readFileSync, statSync } from "fs";
import { CancelledError } from "../../jobs/cancel-registry.mjs";

const API_VERSION = "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${API_VERSION}`;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

function abortedError(signal) {
  return signal?.reason instanceof CancelledError ? signal.reason : new CancelledError();
}

async function graphFetch(url, { method = "GET", body, headers, signal } = {}) {
  let res;
  try {
    res = await fetch(url, { method, body, headers, signal });
  } catch (err) {
    if (signal?.aborted) throw abortedError(signal);
    throw new Error(`Facebook Graph API request failed: ${err.message}`, { cause: err });
  }
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || data?.error) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Facebook Graph API lỗi: ${msg}`);
  }
  return data;
}

function sleep(ms, signal) {
  return new Promise((resolvePromise, reject) => {
    const t = setTimeout(resolvePromise, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(abortedError(signal));
    }, { once: true });
  });
}

/** Quick "is this Page ID + token valid and matched" check — used by the "Kiểm tra kết
 *  nối" button in Hồ sơ kênh, doesn't touch video_reels at all. */
export async function testConnection({ pageId, pageAccessToken, signal }) {
  if (!pageId?.trim()) throw new Error("Thiếu Facebook Page ID");
  if (!pageAccessToken?.trim()) throw new Error("Thiếu Facebook Page Access Token");
  const url = `${GRAPH_BASE}/${encodeURIComponent(pageId)}?fields=name&access_token=${encodeURIComponent(pageAccessToken)}`;
  const data = await graphFetch(url, { signal });
  return { pageName: data.name };
}

async function startUploadSession({ pageId, pageAccessToken, signal }) {
  const url = `${GRAPH_BASE}/${encodeURIComponent(pageId)}/video_reels`;
  const body = new URLSearchParams({ upload_phase: "start", access_token: pageAccessToken });
  const data = await graphFetch(url, { method: "POST", body, signal });
  return { videoId: data.video_id, uploadUrl: data.upload_url };
}

async function uploadVideoFile({ uploadUrl, pageAccessToken, videoPath, signal }) {
  const fileSize = statSync(videoPath).size;
  const fileBuffer = readFileSync(videoPath);
  await graphFetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${pageAccessToken}`,
      offset: "0",
      file_size: String(fileSize),
    },
    body: fileBuffer,
    signal,
  });
  return { bytes: fileSize };
}

async function finishUpload({ pageId, pageAccessToken, videoId, description, signal }) {
  const url = `${GRAPH_BASE}/${encodeURIComponent(pageId)}/video_reels`;
  const body = new URLSearchParams({
    upload_phase: "finish",
    video_id: videoId,
    video_state: "PUBLISHED",
    access_token: pageAccessToken,
    ...(description?.trim() ? { description: description.trim() } : {}),
  });
  await graphFetch(url, { method: "POST", body, signal });
}

async function pollUntilPublished({ videoId, pageAccessToken, signal }) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const url = `${GRAPH_BASE}/${encodeURIComponent(videoId)}?fields=status&access_token=${encodeURIComponent(pageAccessToken)}`;
    const data = await graphFetch(url, { signal });
    const publishStatus = data.status?.publishing_phase?.status;
    const processingStatus = data.status?.processing_phase?.status;
    if (processingStatus === "error" || publishStatus === "error") {
      throw new Error(`Facebook xử lý video thất bại: ${JSON.stringify(data.status)}`);
    }
    if (publishStatus === "complete") return;
    if (Date.now() > deadline) throw new Error("Hết thời gian chờ Facebook xử lý video (5 phút) — kiểm tra lại trong Meta Business Suite.");
    await sleep(POLL_INTERVAL_MS, signal);
  }
}

/**
 * Full publish flow for one rendered video. `onEvent` receives `{ type, ... }`
 * progress markers (see web/src/components/LiveLog.jsx's formatEvent for the ones
 * rendered in the UI: "publish-start" / "publish-uploading" / "publish-processing" /
 * "publish-published").
 */
export async function publishReelToFacebook({ pageId, pageAccessToken, videoPath, description, onEvent, signal }) {
  if (!pageId?.trim()) throw new Error("Thiếu Facebook Page ID");
  if (!pageAccessToken?.trim()) throw new Error("Thiếu Facebook Page Access Token");

  onEvent?.({ type: "publish-start" });
  const { videoId, uploadUrl } = await startUploadSession({ pageId, pageAccessToken, signal });

  onEvent?.({ type: "publish-uploading" });
  const { bytes } = await uploadVideoFile({ uploadUrl, pageAccessToken, videoPath, signal });
  onEvent?.({ type: "publish-uploading", bytes });

  await finishUpload({ pageId, pageAccessToken, videoId, description, signal });

  onEvent?.({ type: "publish-processing" });
  await pollUntilPublished({ videoId, pageAccessToken, signal });

  onEvent?.({ type: "publish-published", videoId });
  return { videoId };
}
