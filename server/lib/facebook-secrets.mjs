/**
 * Facebook Page Access Token storage — kept OUT of `server/profiles/*.json` on
 * purpose. Profile files are committed straight to GitHub (confirmed with the user),
 * but a Page Access Token is a live credential, not a style/config choice like the
 * rest of a profile. Mirrors `lib/profiles.mjs`'s file-per-slug shape in a sibling
 * gitignored directory instead, keyed by the SAME slug (never re-slugified — a
 * profile's slug is already the sanitized identity, see profiles.mjs's own doc
 * comment on why filenames come from untrusted input there).
 *
 * The token is never returned to the client in full — routes.mjs only ever exposes
 * `hasPageAccessToken()`'s boolean, never the raw value from `getPageAccessToken()`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, resolve } from "path";

export const SECRETS_DIR = resolve(import.meta.dirname, "..", "profiles", "secrets");

function ensureDir() {
  if (!existsSync(SECRETS_DIR)) mkdirSync(SECRETS_DIR, { recursive: true });
}

function fileFor(slug) {
  return join(SECRETS_DIR, `${slug}.json`);
}

export function getPageAccessToken(slug) {
  const file = fileFor(slug);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8")).pageAccessToken ?? null;
  } catch {
    return null;
  }
}

export function hasPageAccessToken(slug) {
  return Boolean(getPageAccessToken(slug));
}

export function savePageAccessToken(slug, pageAccessToken) {
  if (!slug) throw new Error("slug is required");
  if (!pageAccessToken?.trim()) throw new Error("pageAccessToken is required");
  ensureDir();
  writeFileSync(fileFor(slug), JSON.stringify({ pageAccessToken: pageAccessToken.trim() }, null, 2));
}

export function deletePageAccessToken(slug) {
  const file = fileFor(slug);
  if (existsSync(file)) unlinkSync(file);
}
