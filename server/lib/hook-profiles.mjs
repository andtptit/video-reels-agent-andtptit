/**
 * "Hook profiles" — niche presets for the "Đọc Caption" tab (components/Hook.jsx), a
 * fully separate video format from the rest of this workspace: no voiceover, a single
 * blurred-footage card with a static hook headline + highlighted keyword + "Top N"
 * line + CTA, driving the user to read the post caption for the full list. Deliberately
 * NOT stored in lib/profiles.mjs's PROFILE_FIELDS — that field set is entirely about
 * TTS/visual-template choices this format doesn't have (no ttsProvider/subStyle/
 * visualStyle), and every screen that calls listProfiles() (Pipeline.jsx, Batch.jsx)
 * would otherwise start showing niche profiles mixed in with channel profiles, since
 * neither that list nor its consumers have any "kind" filter. A second flat directory,
 * mirroring profiles.mjs's own file-per-profile shape exactly, keeps the two fully
 * decoupled — matching profiles.mjs's own stated convention ("shared flat directory
 * matches the rest of the app instead of over-engineering scoping") applied to a
 * second, unrelated set of fields instead of retrofitting scoping into the first.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import { join, resolve } from "path";

export const HOOK_PROFILES_DIR = resolve(import.meta.dirname, "..", "hook-profiles");

function ensureDir() {
  if (!existsSync(HOOK_PROFILES_DIR)) mkdirSync(HOOK_PROFILES_DIR, { recursive: true });
}

// Same slugify as lib/profiles.mjs — duplicated rather than imported since the two
// modules are meant to stay fully decoupled (see doc comment above).
function slugify(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 60);
}

const HOOK_PROFILE_FIELDS = [
  "nicheDescription", // fed as idea-generator.mjs's `channelTheme` — e.g. "phụ nữ chăm chồng"
  "audience",
  "ctaText", // default applied at read-time by callers, not baked in here
  "highlightColor",
  "fontFamily",
  "videoDurationSec",
  "blurPercent", // 0-100, see templates/hook-style.mjs's px formula
  "footageFolder", // absolute path override; empty/undefined = shared assets/footage-library/
  // Background-footage config — same shape/meaning as "footage" template's own
  // footageConfig (see pipeline/build-footage-plan.mjs), just a separate copy of the
  // field names since this profile store is intentionally decoupled from
  // lib/profiles.mjs's PROFILE_FIELDS.
  "footageMinClips",
  "footageMaxClips",
  "footageMinSeconds",
  "footageMaxSeconds",
  "footageFlipEnabled",
  "footageSpeedEnabled",
  "footageSpeedMin",
  "footageSpeedMax",
  "musicTrack",
  "musicVolume",
];

export function listHookProfiles() {
  ensureDir();
  return readdirSync(HOOK_PROFILES_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("._"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(HOOK_PROFILES_DIR, f), "utf-8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function saveHookProfile(name, data) {
  const slug = slugify(name);
  if (!slug) throw new Error("Tên profile không hợp lệ (cần ít nhất 1 ký tự chữ/số)");
  ensureDir();
  const payload = { name: String(name).trim(), slug, updatedAt: new Date().toISOString() };
  for (const field of HOOK_PROFILE_FIELDS) {
    if (data?.[field] !== undefined) payload[field] = data[field];
  }
  writeFileSync(join(HOOK_PROFILES_DIR, `${slug}.json`), JSON.stringify(payload, null, 2));
  return payload;
}

export function deleteHookProfile(slug) {
  const safeSlug = slugify(slug);
  const file = join(HOOK_PROFILES_DIR, `${safeSlug}.json`);
  if (existsSync(file)) unlinkSync(file);
}
