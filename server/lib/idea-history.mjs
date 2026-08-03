/**
 * Dead-simple duplicate-avoidance for batch idea-generation (see
 * agents/idea-generator.mjs) — an append-only JSON array per channel profile, no
 * embeddings/vector DB. Ported pattern from a sibling content-creation repo
 * (hqbt-content-creation): "just read the last N things actually published and tell
 * the model to avoid those" — confirmed there as a simple, working approach.
 *
 * A record is appended ONLY once a batch-approved idea's real project has finished
 * content-planner successfully (see Batch.jsx's approval loop) — never at generation
 * time, never for an idea the user deleted/unchecked, never for one whose project
 * creation or content-planner run failed. This keeps the history meaning "videos that
 * actually got made," matching the reference repo's own "avoid what's been posted"
 * semantics (drafts that went nowhere shouldn't block a similar future idea).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PROFILES_DIR } from "./profiles.mjs";

const MAX_STORED = 200; // bounded file size — oldest entries trimmed on append

function historyFile(profileSlug) {
  return join(PROFILES_DIR, `${profileSlug}-ideas-history.json`);
}

function readAll(profileSlug) {
  const file = historyFile(profileSlug);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

/** @returns {{idea, subTopic, hookStyle, tone, projectId, createdAt}[]} most recent first N kept. */
export function readIdeaHistory(profileSlug, { limit = 30 } = {}) {
  return readAll(profileSlug).slice(-limit);
}

export function appendIdeaHistory(profileSlug, { idea, subTopic, hookStyle, tone, projectId }) {
  if (!profileSlug) throw new Error("profileSlug là bắt buộc để ghi lịch sử ý tưởng");
  if (!idea || !subTopic) throw new Error("idea và subTopic là bắt buộc để ghi lịch sử");
  const all = readAll(profileSlug);
  const record = {
    idea,
    subTopic,
    hookStyle: hookStyle ?? null,
    tone: tone ?? null,
    projectId: projectId ?? null,
    createdAt: new Date().toISOString(),
  };
  all.push(record);
  mkdirSync(PROFILES_DIR, { recursive: true });
  writeFileSync(historyFile(profileSlug), JSON.stringify(all.length > MAX_STORED ? all.slice(-MAX_STORED) : all, null, 2));
  return record;
}
