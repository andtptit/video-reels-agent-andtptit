/**
 * Maps between REST project ids (URL path segments) and real project directories
 * on disk. Project state lives entirely on disk (output/YYYY-MM-DD/{slug}/video/,
 * see CLAUDE.md), so the id is just that relative path, URL-encoded — no database.
 *
 * Every id from the network is untrusted input, so resolution is sandboxed the same
 * way fs-tools.mjs sandboxes agent file writes: must resolve inside <repo>/output/,
 * rejecting ".." traversal.
 */
import { resolve, relative, isAbsolute, sep, join } from "path";
import { readdirSync, existsSync, statSync } from "fs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const OUTPUT_ROOT = resolve(ROOT, "output");

export class InvalidProjectIdError extends Error {}

export function resolveProjectDir(id) {
  let rel;
  try {
    rel = decodeURIComponent(id);
  } catch {
    throw new InvalidProjectIdError(`Malformed project id: ${id}`);
  }
  const abs = resolve(OUTPUT_ROOT, rel);
  const relToOutput = relative(OUTPUT_ROOT, abs);
  const escapes = relToOutput === ".." || relToOutput.startsWith(`..${sep}`) || isAbsolute(relToOutput);
  if (escapes) throw new InvalidProjectIdError(`Project id escapes output/: ${id}`);
  return abs;
}

export function toProjectId(projectDirAbs) {
  return relative(OUTPUT_ROOT, resolve(projectDirAbs)).split(sep).join("/");
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
}

/**
 * Walks output/YYYY-MM-DD/{slug}/video/ (the fixed layout from CLAUDE.md) and
 * returns one entry per project that has actually been through `hyperframes init`
 * (has an index.html) — skips anything mid-creation or otherwise malformed.
 */
export function listProjects() {
  const projects = [];
  for (const dateDir of safeReaddir(OUTPUT_ROOT)) {
    const dateAbs = join(OUTPUT_ROOT, dateDir.name);
    for (const slugDir of safeReaddir(dateAbs)) {
      const projectDir = join(dateAbs, slugDir.name, "video");
      if (!existsSync(join(projectDir, "index.html"))) continue;
      const mtime = statSync(projectDir).mtimeMs;
      projects.push({ id: toProjectId(projectDir), slug: slugDir.name, date: dateDir.name, mtime });
    }
  }
  projects.sort((a, b) => b.mtime - a.mtime);
  return projects;
}
