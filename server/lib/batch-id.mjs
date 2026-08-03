/**
 * Maps between REST batch ids and working directories under `server/batches/` —
 * deliberately NOT under `output/`, so `project-id.mjs`'s `listProjects()` (which
 * only walks `output/YYYY-MM-DD/{slug}/video/`) never sees these and they can't leak
 * into History/ProjectPicker. A "batch" here is the idea-generation stage's scratch
 * dir (see idea-generator.mjs) — once ideas are approved, real projects are created
 * via the normal `createProject()`/`runContentPlanner()` path and live under
 * `output/` like any other project; the batch dir's job is done at that point.
 *
 * Ids are flat (no date/slug nesting like project ids), so the traversal guard also
 * rejects any path separator in the id — a project id like "2026-08-01/foo/video" is
 * legitimately nested, a batch id never should be.
 */
import { resolve, relative, isAbsolute, sep } from "path";
import { mkdirSync } from "fs";
import { randomBytes } from "crypto";

const ROOT = resolve(import.meta.dirname, "..", "..");
const BATCHES_ROOT = resolve(ROOT, "server", "batches");

export class InvalidBatchIdError extends Error {}

export function newBatchId() {
  return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export function resolveBatchDir(id) {
  let rel;
  try {
    rel = decodeURIComponent(id);
  } catch {
    throw new InvalidBatchIdError(`Malformed batch id: ${id}`);
  }
  if (rel.includes("/") || rel.includes("\\")) {
    throw new InvalidBatchIdError(`Batch id must be flat (no path separators): ${id}`);
  }
  const abs = resolve(BATCHES_ROOT, rel);
  const relToRoot = relative(BATCHES_ROOT, abs);
  const escapes = relToRoot === ".." || relToRoot.startsWith(`..${sep}`) || isAbsolute(relToRoot);
  if (escapes) throw new InvalidBatchIdError(`Batch id escapes server/batches/: ${id}`);
  return abs;
}

/** @returns {{id: string, dir: string}} a freshly created, empty batch working dir. */
export function createBatchDir() {
  const id = newBatchId();
  const dir = resolve(BATCHES_ROOT, id);
  mkdirSync(dir, { recursive: true });
  return { id, dir };
}
