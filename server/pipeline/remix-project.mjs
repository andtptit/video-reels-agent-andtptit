/**
 * Sync scaffolding for a "remix" project — copies everything reusable from an
 * existing style="sub" project into a brand-new project dir, so the expensive part
 * (AI images) never gets regenerated. See remix-scenes.mjs for the LLM half (writes
 * the new scenes.json); this file only ever touches the filesystem, no LLM calls.
 */
import { existsSync, cpSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createProject } from "./new-project.mjs";
import { toProjectId } from "../lib/project-id.mjs";

/**
 * @param {object} params
 * @param {string} params.sourceProjectDir - absolute path to the project being remixed
 * @param {string} params.remixIdea - short text used only to derive the new
 *   project's date/slug folder name (createProject's `idea` param) — NOT the remix
 *   instruction itself (that's `remixPrompt`, passed straight to runRemixScenes).
 * @param {string} [params.fontFamily] - overrides the copied video-plan.json's
 *   fontFamily; omit to keep the source project's font.
 * @returns {{ projectDir: string, sourceScenes: object[] }}
 */
export function createRemixProject({ sourceProjectDir, remixIdea, fontFamily }) {
  const videoPlanFile = join(sourceProjectDir, "video-plan.json");
  const timingFile = join(sourceProjectDir, "scenes-with-timing.json");
  if (!existsSync(videoPlanFile)) throw new Error("Project gốc chưa có video-plan.json");
  if (!existsSync(timingFile)) throw new Error("Project gốc chưa có scenes-with-timing.json");

  const sourceVideoPlan = JSON.parse(readFileSync(videoPlanFile, "utf-8"));
  if (sourceVideoPlan.template !== "sub") {
    throw new Error('Remix chỉ hỗ trợ video style "sub" (ảnh AI full-bleed) — project gốc dùng style khác.');
  }
  const sourceTiming = JSON.parse(readFileSync(timingFile, "utf-8"));

  const { projectDir, platform } = createProject(remixIdea, {
    orientation: sourceVideoPlan.format === "16:9" ? "landscape" : "portrait",
  });

  // Skip filter: AppleDouble sidecar junk (see plan.md — recurring on this external
  // volume) shouldn't propagate into the fresh project.
  const skipJunk = (src) => !src.split("/").pop().startsWith("._");

  // Reuse as-is — the whole point of remix. NOT copied: assets/audio (old voice for
  // OLD narration — must regenerate for the new narration, copying it over would
  // make generate-audio.mjs's existsSync skip-check wrongly keep the stale voice),
  // compositions/*.html + index.html (hyperframes init already scaffolded blanks;
  // rewritten once real audio for the new narration exists).
  for (const dir of ["assets/images", "assets/music", "assets/sfx"]) {
    const src = join(sourceProjectDir, dir);
    if (existsSync(src)) cpSync(src, join(projectDir, dir), { recursive: true, filter: skipJunk });
  }
  if (existsSync(join(sourceProjectDir, "DESIGN.md"))) {
    cpSync(join(sourceProjectDir, "DESIGN.md"), join(projectDir, "DESIGN.md"));
  }

  // Not read by any pipeline step — purely informational, so ProjectPicker/Pipeline
  // can show "remix từ <project>" instead of the relationship being invisible once
  // the new project exists on disk (confirmed as a real gap: nothing recorded which
  // project a remix came from, made it hard to track multiple remixes of one video).
  const newVideoPlan = { ...sourceVideoPlan, remixedFrom: toProjectId(sourceProjectDir) };
  if (fontFamily) newVideoPlan.fontFamily = fontFamily;
  writeFileSync(join(projectDir, "video-plan.json"), JSON.stringify(newVideoPlan, null, 2));

  return { projectDir, platform, sourceScenes: sourceTiming.scenes ?? [] };
}
