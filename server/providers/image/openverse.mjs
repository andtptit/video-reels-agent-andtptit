/**
 * Openverse image search — aggregates 800M+ CC-licensed items from Flickr,
 * Wikimedia Commons, museums, etc. Same shape as pexels.mjs (search → get URL →
 * download → save, same existsSync-skip cache) so sub-scene-writer.mjs can pick
 * either provider through a symmetric contract — see IMAGE_SEARCH_PROVIDERS there.
 *
 * Filtered to `license=cc0,pdm` (Creative Commons Zero + Public Domain Mark) ONLY —
 * confirmed live via curl: no API key needed for anonymous search at this volume.
 * Deliberately narrower than Openverse's full catalog (which includes CC-BY/CC-BY-SA,
 * requiring attribution) — user chose this simplicity over broader/more precise
 * results for phase 1: no per-image credit line to track/display anywhere, same
 * "silent, no visible attribution" property Pexels already has. `license_url`/
 * `creator` are still returned by the API and could be surfaced later if this ever
 * widens to attribution-required licenses — not used for anything today.
 */
import { writeFileSync, existsSync, statSync } from "fs";
import { CancelledError } from "../../jobs/cancel-registry.mjs";

const SEARCH_ENDPOINT = "https://api.openverse.org/v1/images/";
const LICENSE_FILTER = "cc0,pdm";

function aspectRatioForFormat(format) {
  if (format === "16:9") return "wide";
  if (format === "1:1") return "square";
  return "tall";
}

/** @returns {Promise<{imageUrl: string, photographer: string} | null>} null = no matching photo (not an error) */
export async function searchPhoto({ query, format = "9:16", signal }) {
  const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}&license=${LICENSE_FILTER}&aspect_ratio=${aspectRatioForFormat(format)}&page_size=1`;

  let res;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    throw new Error(`Openverse search failed: ${err.message}`, { cause: err });
  }
  if (!res.ok) throw new Error(`Openverse search failed (${res.status}): ${await res.text()}`);

  const data = await res.json();
  const photo = data.results?.[0];
  if (!photo) return null;
  return { imageUrl: photo.url, photographer: photo.creator };
}

/**
 * Searches + immediately downloads into destPath. Same skip-if-exists /
 * `{found:false}`-on-no-match contract as pexels.mjs's searchAndSavePhoto.
 */
export async function searchAndSavePhoto({ query, format, destPath, signal }) {
  if (existsSync(destPath)) {
    return { destPath, bytes: statSync(destPath).size, skipped: true, found: true };
  }
  const result = await searchPhoto({ query, format, signal });
  if (!result) return { destPath: null, bytes: 0, skipped: false, found: false };

  let res;
  try {
    res = await fetch(result.imageUrl, { signal });
  } catch (err) {
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    throw err;
  }
  if (!res.ok) throw new Error(`Failed to download Openverse photo (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buf);
  return { destPath, bytes: buf.length, skipped: false, found: true, photographer: result.photographer };
}
