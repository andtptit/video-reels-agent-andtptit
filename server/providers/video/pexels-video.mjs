/**
 * Pexels stock-VIDEO search — real footage by keyword, same PEXELS_API_KEY as
 * providers/image/pexels.mjs (free tier, no attribution required by license), but a
 * completely separate endpoint/response shape from the photo search (Pexels Videos
 * is `/videos/search`, not `/v1/search`) — this file didn't exist before even though
 * the key was already wired up for photos only (found live: user assumed video
 * search already worked because the env var was there).
 *
 * Downloads land in the SAME shared "footage-library" folder convention this
 * workspace already uses (see lib/footage-library.mjs) — this module only does
 * search+download, never touches the library's manifest/scan logic itself.
 */
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { CancelledError } from "../../jobs/cancel-registry.mjs";

const SEARCH_ENDPOINT = "https://api.pexels.com/videos/search";

function orientationForFormat(format) {
  return format === "16:9" ? "landscape" : "portrait";
}

/** Picks the smallest mp4 file_type variant that's still >= 720px on its long edge —
 *  Pexels returns several qualities per video (uhd/hd/sd) across BOTH orientations
 *  regardless of the search's own `orientation` param, so this can't just take
 *  `video_files[0]`; a 4K variant would make every downstream ffmpeg cut far slower
 *  than needed for a short-form 1080-wide output. */
function pickVideoFile(videoFiles, wantPortrait) {
  const mp4s = (videoFiles ?? []).filter((f) => f.file_type === "video/mp4");
  const oriented = mp4s.filter((f) => (wantPortrait ? f.height > f.width : f.width > f.height));
  const pool = oriented.length ? oriented : mp4s;
  const goodEnough = pool.filter((f) => Math.max(f.width, f.height) >= 720);
  const candidates = goodEnough.length ? goodEnough : pool;
  return candidates.sort((a, b) => Math.max(a.width, a.height) - Math.max(b.width, b.height))[0] ?? null;
}

/** @returns {Promise<{videoUrl: string, id: number, photographer: string}[]>} */
export async function searchVideos({ query, format = "9:16", count = 8, apiKey = process.env.PEXELS_API_KEY, signal }) {
  if (!apiKey) throw new Error("Missing PEXELS_API_KEY");
  const perPage = Math.min(Math.max(Number(count) || 8, 1), 80); // Pexels' own per_page cap
  const url = `${SEARCH_ENDPOINT}?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=${orientationForFormat(format)}`;

  let res;
  try {
    res = await fetch(url, { headers: { Authorization: apiKey }, signal });
  } catch (err) {
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    throw new Error(`Pexels video search failed: ${err.message}`, { cause: err });
  }
  if (!res.ok) throw new Error(`Pexels video search failed (${res.status}): ${await res.text()}`);

  const data = await res.json();
  const wantPortrait = format !== "16:9";
  return (data.videos ?? [])
    .map((v) => {
      const file = pickVideoFile(v.video_files, wantPortrait);
      return file ? { videoUrl: file.link, id: v.id, photographer: v.user?.name ?? "unknown" } : null;
    })
    .filter(Boolean);
}

/**
 * Searches + downloads up to `count` clips into `destDir` (created if missing).
 * Filenames are `pexels-{id}.mp4` — stable per source video, so re-running the same
 * query is naturally idempotent (existing files skipped, same "don't waste the free
 * tier re-fetching" convention as searchAndSavePhoto).
 *
 * `query` accepts a single string OR an array of keywords — found live (user
 * feedback): 1 narrow LLM-suggested phrase (e.g. "man working hard") returns too few
 * good matches on Pexels; several short keywords (gym, running, discipline...)
 * called ONE AT A TIME cover the topic far better than one over-specific phrase.
 * `count` is PER keyword when an array is given (so "3 keywords × count 5" = up to 15
 * clips), not split across them — simpler to reason about than dividing a fixed
 * total unevenly.
 */
export async function searchAndSaveVideos({ query, format, count, destDir, apiKey, signal }) {
  mkdirSync(destDir, { recursive: true });
  const keywords = (Array.isArray(query) ? query : [query]).map((q) => q?.trim()).filter(Boolean);

  let found = 0;
  let downloaded = 0;
  let skipped = 0;
  const errors = [];
  const byKeyword = [];
  for (const keyword of keywords) {
    const results = await searchVideos({ query: keyword, format, count, apiKey, signal });
    found += results.length;
    let kwDownloaded = 0;
    let kwSkipped = 0;
    for (const r of results) {
      const destPath = join(destDir, `pexels-${r.id}.mp4`);
      if (existsSync(destPath)) {
        skipped++;
        kwSkipped++;
        continue;
      }
      try {
        const res = await fetch(r.videoUrl, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
        downloaded++;
        kwDownloaded++;
      } catch (err) {
        if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
        errors.push({ id: r.id, keyword, error: err.message });
      }
    }
    byKeyword.push({ keyword, found: results.length, downloaded: kwDownloaded, skipped: kwSkipped });
  }
  return { found, downloaded, skipped, errors, byKeyword };
}
