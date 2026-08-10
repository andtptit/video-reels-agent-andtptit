/**
 * Pexels stock-photo search — real photos by keyword, free tier (200 req/hr, 20k/
 * month, no attribution required by license). Mirrors dashscope-image.mjs's
 * generateAndSaveImage() shape (search → get URL → download → save, same
 * existsSync-skip cache convention) so sub-scene-writer.mjs can call either
 * acquisition path through a symmetric contract.
 *
 * Key difference from the AI provider: this is a SEARCH, not a generation — "no
 * result" is a real, expected outcome (not an error). Callers decide how to handle a
 * miss (this file never invents a placeholder image).
 */
import { writeFileSync, existsSync, statSync } from "fs";
import { CancelledError } from "../../jobs/cancel-registry.mjs";

const SEARCH_ENDPOINT = "https://api.pexels.com/v1/search";

function orientationForFormat(format) {
  if (format === "16:9") return "landscape";
  if (format === "1:1") return "square";
  return "portrait";
}

/** @returns {Promise<{imageUrl: string, photographer: string} | null>} null = no matching photo (not an error) */
export async function searchPhoto({ query, format = "9:16", apiKey = process.env.PEXELS_API_KEY, signal }) {
  if (!apiKey) throw new Error("Missing PEXELS_API_KEY");
  const url = `${SEARCH_ENDPOINT}?query=${encodeURIComponent(query)}&per_page=1&orientation=${orientationForFormat(format)}`;

  let res;
  try {
    res = await fetch(url, { headers: { Authorization: apiKey }, signal });
  } catch (err) {
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    throw new Error(`Pexels search failed: ${err.message}`, { cause: err });
  }
  if (!res.ok) throw new Error(`Pexels search failed (${res.status}): ${await res.text()}`);

  const data = await res.json();
  const photo = data.photos?.[0];
  if (!photo) return null;
  return { imageUrl: photo.src.large2x ?? photo.src.original, photographer: photo.photographer };
}

/**
 * Searches + immediately downloads into destPath. Skips entirely if destPath already
 * exists (same "already have it, don't re-fetch" convention as
 * dashscope-image.mjs's generateAndSaveImage — here it conserves the free-tier rate
 * limit rather than money, same practical effect). Returns `{found:false}` (no file
 * written) when Pexels has no matching photo for the query — NOT thrown, since a
 * miss is a normal, expected search outcome the caller must decide how to handle.
 */
export async function searchAndSavePhoto({ query, format, destPath, apiKey, signal }) {
  if (existsSync(destPath)) {
    return { destPath, bytes: statSync(destPath).size, skipped: true, found: true };
  }
  const result = await searchPhoto({ query, format, apiKey, signal });
  if (!result) return { destPath: null, bytes: 0, skipped: false, found: false };

  let res;
  try {
    res = await fetch(result.imageUrl, { signal });
  } catch (err) {
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    throw err;
  }
  if (!res.ok) throw new Error(`Failed to download Pexels photo (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buf);
  return { destPath, bytes: buf.length, skipped: false, found: true, photographer: result.photographer };
}
