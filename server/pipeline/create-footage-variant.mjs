/**
 * Sync scaffolding for a "footage variant" project — copies the narration/voice from
 * an existing `template: "footage"` project into a brand-new project dir UNCHANGED
 * (no content-planner call, no TTS call — the whole point), then re-points footage
 * clip picking (`footageConfig.libraryDir`) and/or the background music track. The
 * new project still needs each scene generated (`POST /projects/:id/scenes/:id/generate`
 * — re-picks random clips via footage-scene-writer.mjs) + root + render, same as any
 * other project; this file only handles the filesystem scaffolding + skipping the
 * three steps that don't need to run again.
 *
 * Mirrors remix-project.mjs's shape (see that file for the "sub" template's own
 * remix), but inverted: remix keeps the expensive AI IMAGES and regenerates
 * narration+voice around them; this keeps the expensive narration+VOICE and
 * regenerates the (free, local) footage/music picks around it.
 */
import { existsSync, cpSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { createProject } from "./new-project.mjs";
import { toProjectId } from "../lib/project-id.mjs";
import { emitProgress, readJobStatus, setProjectProfile } from "../jobs/job-status.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * @param {object} params
 * @param {string} params.sourceProjectDir - absolute path to the project being varied
 * @param {string} params.variantIdea - short text used only to derive the new
 *   project's date/slug folder name (createProject's `idea` param)
 * @param {string} [params.libraryDir] - overrides footageConfig.libraryDir (workspace-
 *   relative, e.g. "assets/footage-library/foo"); omit to keep the source's own folder
 * @param {string} [params.musicTrack] - bare filename with no extension/path (matches
 *   GET /music-library's shape) to swap the background music to; omit to keep reusing
 *   the source project's own track
 * @param {number} [params.musicVolume] - overrides _audio.music_volume; omit to keep
 *   the source's own value
 * @returns {{ projectDir: string, platform: string, sceneIds: string[] }}
 */
export function createFootageVariant({ sourceProjectDir, variantIdea, libraryDir, musicTrack, musicVolume }) {
  const videoPlanFile = join(sourceProjectDir, "video-plan.json");
  const timingFile = join(sourceProjectDir, "scenes-with-timing.json");
  if (!existsSync(videoPlanFile)) throw new Error("Project gốc chưa có video-plan.json");
  if (!existsSync(timingFile)) throw new Error("Project gốc chưa có scenes-with-timing.json");

  const sourceVideoPlan = JSON.parse(readFileSync(videoPlanFile, "utf-8"));
  if (sourceVideoPlan.template !== "footage") {
    throw new Error('Tạo biến thể chỉ hỗ trợ template "footage" — project gốc dùng template khác.');
  }
  const sourceTiming = JSON.parse(readFileSync(timingFile, "utf-8"));
  const sceneIds = (sourceTiming.scenes ?? []).map((s) => s.sceneId);
  if (!sceneIds.length) throw new Error("Project gốc không có scene nào trong scenes-with-timing.json.");

  const { projectDir, platform } = createProject(variantIdea, {
    orientation: sourceVideoPlan.format === "16:9" ? "landscape" : "portrait",
  });

  const skipJunk = (src) => !src.split("/").pop().startsWith("._");

  // Voice/narration reused byte-for-byte — this is the entire cost saving (no
  // content-planner call, no TTS call). assets/sfx mirrors remix-project.mjs's own
  // copy list for parity; footage template has no assets/images to copy.
  for (const dir of ["assets/audio", "assets/sfx"]) {
    const src = join(sourceProjectDir, dir);
    if (existsSync(src)) cpSync(src, join(projectDir, dir), { recursive: true, filter: skipJunk });
  }
  for (const file of ["DESIGN.md", "master_content.md", "scenes.json"]) {
    const src = join(sourceProjectDir, file);
    if (existsSync(src)) cpSync(src, join(projectDir, file));
  }

  // Only `_audio` (music) may change here — narration text, per-word timestamps, and
  // scene durations MUST stay byte-identical to the source, since root-composer's
  // captions/crossfades are built against the (reused) voice audio's real timing.
  const timing = { ...sourceTiming };
  if (musicTrack) {
    const musicSrc = join(ROOT, "assets", "music", `${musicTrack}.mp3`);
    if (!existsSync(musicSrc)) throw new Error(`Không tìm thấy nhạc "${musicTrack}" trong assets/music/`);
    mkdirSync(join(projectDir, "assets", "music"), { recursive: true });
    cpSync(musicSrc, join(projectDir, "assets", "music", `${musicTrack}.mp3`));
    timing._audio = { ...timing._audio, music_track: `assets/music/${musicTrack}.mp3`, ...(musicVolume != null ? { music_volume: musicVolume } : {}) };
  } else if (timing._audio?.music_track) {
    // Keeping the SAME track as the source — still needs its own copy into the new
    // project dir (unlike assets/audio/sfx above, assets/music isn't reused wholesale).
    const trackName = timing._audio.music_track.split("/").pop();
    const musicSrc = join(sourceProjectDir, "assets", "music", trackName);
    if (existsSync(musicSrc)) {
      mkdirSync(join(projectDir, "assets", "music"), { recursive: true });
      cpSync(musicSrc, join(projectDir, "assets", "music", trackName));
    }
    if (musicVolume != null) timing._audio = { ...timing._audio, music_volume: musicVolume };
  }
  writeFileSync(join(projectDir, "scenes-with-timing.json"), JSON.stringify(timing, null, 2));

  const newVideoPlan = {
    ...sourceVideoPlan,
    remixedFrom: toProjectId(sourceProjectDir),
    ...(libraryDir ? { footageConfig: { ...sourceVideoPlan.footageConfig, libraryDir } } : {}),
  };
  writeFileSync(join(projectDir, "video-plan.json"), JSON.stringify(newVideoPlan, null, 2));

  // Fake the 3 steps this variant skips entirely as already "done" — same device
  // remix-project.mjs uses for its own single "video-plan" fake-done, extended to all
  // 3 here since a footage variant reuses even more (that flow still regenerates
  // narration+voice via an LLM call; this one reuses both untouched).
  for (const step of ["plan", "audio", "video-plan"]) {
    emitProgress(projectDir, { step, status: "done" });
  }

  // profileSlug lives in job-status.json, not in any of the files copied above — a
  // variant with no profileSlug fell through every profile filter in History.jsx's
  // grid (found live: user report), landing only under "Tất cả". Carry the source
  // project's own profile forward so the variant shows up exactly where its source did.
  const sourceProfileSlug = readJobStatus(sourceProjectDir).profileSlug;
  if (sourceProfileSlug) setProjectProfile(projectDir, sourceProfileSlug);

  return { projectDir, platform, sceneIds };
}
