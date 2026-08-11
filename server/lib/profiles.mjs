/**
 * "Channel profiles" — a named bundle of the pipeline's manual setup choices (TTS
 * rate, template/style, font, image style prefix, which models to use) that a user
 * running multiple channels wants to reuse across projects instead of re-picking
 * every time. Deliberately excludes `audience` — that's per-video, not per-channel
 * (confirmed with user: audience changes with each project's actual target, while
 * everything else here is closer to a channel's fixed "house style").
 *
 * Stored as flat JSON files under server/profiles/ (not per-project — profiles are
 * shared across the whole workspace, same lifetime as DESIGN.md). No auth/multi-user
 * concept exists anywhere else in this server, so a shared flat directory matches
 * the rest of the app instead of over-engineering scoping that nothing else has.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import { join, resolve } from "path";

export const PROFILES_DIR = resolve(import.meta.dirname, "..", "profiles"); // exported for idea-history.mjs

function ensureDir() {
  if (!existsSync(PROFILES_DIR)) mkdirSync(PROFILES_DIR, { recursive: true });
}

// Filenames are derived from user-typed profile names, which are untrusted input —
// slugify instead of using the raw string as a path segment (same reasoning as
// project-id.mjs sandboxing project ids, just simpler since there's no directory
// nesting to escape here).
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

const PROFILE_FIELDS = [
  "ttsProvider",
  "ttsRate",
  "ttsVoice",
  "musicTrack",
  "musicVolume",
  "template",
  "visualStyle",
  "subStyle",
  "fontFamily",
  "imageStylePrefix",
  "kenBurns",
  "grain",
  // subStyle "investigation_board" only — which stock-photo search provider to use
  // ("pexels" | "openverse") — see server/agents/sub-scene-writer.mjs's IMAGE_SEARCH_PROVIDERS.
  "photoProvider",
  "plannerModel",
  "cheapModel",
  "imgModel",
  // Template "footage" config — see pipeline/build-footage-plan.mjs.
  "footageMinClips",
  "footageMaxClips",
  "footageMinSeconds",
  "footageMaxSeconds",
  "footageFlipEnabled",
  "footageSpeedEnabled",
  "footageSpeedMin",
  "footageSpeedMax",
  // Batch idea-generation prefill only (see components/Batch.jsx) — pure convenience,
  // never required. `defaultAudience` bends the "audience is per-video, not
  // per-channel" rule this file's own doc comment states, but only as an editable
  // starting value for a batch run that's explicitly scoped to one channel/profile —
  // the single-video flow (Pipeline.jsx) is untouched and still has no such prefill.
  "channelTheme",
  "defaultAudience",
];

export function listProfiles() {
  ensureDir();
  return readdirSync(PROFILES_DIR)
    // idea-history.mjs writes `{slug}-ideas-history.json` into this SAME directory
    // (see its own doc comment on why — a plain array, not a profile object) —
    // exclude by filename first (cheap), then a content-shape check below as a
    // second line of defense against any other stray non-profile .json file, so a
    // parsed-but-malformed entry can never reach `.name.localeCompare` and crash the
    // whole route for every profile at once (confirmed live: this exact crash was
    // silently emptying the profile dropdown everywhere `listProfiles()` is called,
    // the moment any profile had ever had ideas generated for it).
    .filter((f) => f.endsWith(".json") && !f.endsWith("-ideas-history.json") && !f.startsWith("._"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(PROFILES_DIR, f), "utf-8"));
      } catch {
        return null;
      }
    })
    .filter((p) => p && typeof p.name === "string" && typeof p.slug === "string")
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function saveProfile(name, data) {
  const slug = slugify(name);
  if (!slug) throw new Error("Tên profile không hợp lệ (cần ít nhất 1 ký tự chữ/số)");
  ensureDir();
  const payload = { name: String(name).trim(), slug, updatedAt: new Date().toISOString() };
  for (const field of PROFILE_FIELDS) {
    if (data?.[field] !== undefined) payload[field] = data[field];
  }
  writeFileSync(join(PROFILES_DIR, `${slug}.json`), JSON.stringify(payload, null, 2));
  return payload;
}

export function deleteProfile(slug) {
  const safeSlug = slugify(slug);
  const file = join(PROFILES_DIR, `${safeSlug}.json`);
  if (existsSync(file)) unlinkSync(file);
}
