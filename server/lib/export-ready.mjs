/**
 * "Xuất gọn" — copies a finished project's newest render + caption into a FLAT
 * `output-ready/` folder at the workspace root, named clearly by date+slug — found
 * live (user request): the real `output/YYYY-MM-DD/{slug}/video/` tree carries a lot
 * of pipeline-internal clutter (assets/, compositions/, DESIGN.md, scenes.json...)
 * alongside the one file that actually matters once a video is done. Syncing that
 * whole tree to Drive to post from elsewhere drags all of it along; this folder only
 * ever holds exactly what's needed to post: the video + a copy-paste-ready caption.
 *
 * Caption source: `caption.md` if the caption step has been run, else
 * `master_content.md` (the screenplay) as a usable fallback — never blocks export on
 * a step the user may not have run yet.
 */
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { listProjects, resolveProjectDir } from "./project-id.mjs";
import { listProfiles } from "./profiles.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
export const EXPORT_DIR = join(ROOT, "output-ready");
const UNASSIGNED_FOLDER = "Chưa gắn profile";

function sanitizeFolderName(name) {
  // Windows/Drive-illegal path characters only — Vietnamese diacritics and spaces are
  // fine on every filesystem this workspace actually runs/syncs on.
  const cleaned = String(name ?? "").trim().replace(/[\\/:*?"<>|]/g, "-");
  return cleaned || UNASSIGNED_FOLDER;
}

/**
 * Numeric prefix (1_, 2_, ...) so Drive/Explorer sorts videos in a stable, human-
 * meaningful order — user request. Scoped PER PROFILE SUBFOLDER (each channel's own
 * queue, not one global count) and computed from ALL render-ready projects sharing
 * that profile, oldest-first — so a project gets the SAME number whether exported
 * alone ("Xuất gọn") or as part of "Xuất tất cả", and re-exporting later keeps
 * renumbering consistently as the set of finished projects changes.
 */
function exportPlacement(projectId) {
  const all = listProjects().filter((p) => p.renderDone);
  const target = all.find((p) => p.id === projectId);
  const profileSlug = target?.profileSlug;
  const profile = profileSlug ? listProfiles().find((p) => p.slug === profileSlug) : null;
  const folder = sanitizeFolderName(profile?.name);
  const sameProfile = all.filter((p) => p.profileSlug === profileSlug).sort((a, b) => a.mtime - b.mtime);
  const index = sameProfile.findIndex((p) => p.id === projectId) + 1;
  return { folder, index: index || sameProfile.length + 1 };
}

function newestRender(projectDir) {
  const rendersDir = join(projectDir, "renders");
  if (!existsSync(rendersDir)) return null;
  const files = readdirSync(rendersDir)
    .filter((f) => f.endsWith(".mp4") && !f.startsWith("._"))
    .map((name) => ({ name, mtime: statSync(join(rendersDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.name ?? null;
}

function captionText(projectDir) {
  const captionPath = join(projectDir, "caption.md");
  if (existsSync(captionPath)) return { text: readFileSync(captionPath, "utf-8"), source: "caption.md" };
  const masterPath = join(projectDir, "master_content.md");
  if (existsSync(masterPath)) return { text: readFileSync(masterPath, "utf-8"), source: "master_content.md (chưa chạy bước caption)" };
  return { text: "", source: null };
}

/** @returns {{exported: boolean, videoFile: string|null, captionSource: string|null, destName: string, folder: string|null}} */
export function exportProject(projectId) {
  const projectDir = resolveProjectDir(projectId);
  const [date, slug] = projectId.split("/");
  const render = newestRender(projectDir);
  if (!render) return { exported: false, videoFile: null, captionSource: null, destName: `${date}-${slug}`, folder: null };

  const { folder, index } = exportPlacement(projectId);
  const destName = `${index}_${date}-${slug}`;
  const destDir = join(EXPORT_DIR, folder);

  mkdirSync(destDir, { recursive: true });
  copyFileSync(join(projectDir, "renders", render), join(destDir, `${destName}.mp4`));
  const { text, source } = captionText(projectDir);
  writeFileSync(join(destDir, `${destName}.txt`), text);
  return { exported: true, videoFile: render, captionSource: source, destName, folder };
}

/** Exports every project that has at least 1 render — used by "Xuất tất cả". Always
 *  overwrites (cheap file copy) so a re-render is picked up on the next bulk export
 *  without the caller needing to track what's stale. */
export function exportAllReady() {
  const results = [];
  for (const p of listProjects()) {
    if (!p.renderDone) continue;
    results.push({ id: p.id, slug: p.slug, ...exportProject(p.id) });
  }
  return results;
}
