/**
 * root-composer agent task — automates CLAUDE.md step 6 ("Viết root index.html"),
 * the one step in the pipeline that was NOT automated by content-planner/video-planner/
 * scene-writer. Confirmed live via the UI: without this step, `index.html` stays the
 * blank `hyperframes init` scaffold (a bare 10s empty composition), so `/render`
 * "succeeds" but produces a black video — the scene sub-compositions exist on disk but
 * nothing in the root timeline ever references them.
 *
 * Reuses .agents/skills/hyperframes/SKILL.md verbatim, same as scene-writer.mjs, plus
 * a project-specific override for root-composition conventions (atmosphere tracks 0-6,
 * music track 20, voiceover track 21, scene clips tracks 10/11 alternating, 0.3s
 * crossfade) and a real worked example pulled from a project a human previously
 * authored correctly through Claude Code — concrete numbers beat prose for this kind
 * of layout-heavy authoring task.
 *
 * Same validation gate as scene-writer: lint baseline before writing, diff new
 * findings after each attempt, feed them back for up to maxFixAttempts auto-fix
 * rounds.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";
import { join } from "path";
import { runAgent, CHEAP_MODEL } from "./run-agent.mjs";
import { createFsTools } from "../tools/fs-tools.mjs";
import { lint } from "../tools/hyperframes-cli.mjs";
import { checkPseudoElementAnimations, checkAllCanvasDimensions, checkClipClassOverride, checkVoiceoverOverlap, checkVoiceoverCompleteness } from "../tools/validators.mjs";
import { dimensionsForFormat } from "../lib/canvas.mjs";

const SKILL_PATH = join(import.meta.dirname, "..", "..", ".agents", "skills", "hyperframes", "SKILL.md");
// User-prepared reaction SFX ("cười/vỗ tay cuối mỗi scene") — a separate, code-only
// pool from the id-keyed assets/sfx/ catalog video-planner's LLM picks sfx_picks from
// for "sub"/"motion" (that mechanism doesn't exist for "footage", which has no LLM
// video-plan step at all — see build-footage-plan.mjs's own doc comment). User drops
// .mp3 files directly here; nothing else reads this folder.
const SFX_REACTION_DIR = join(import.meta.dirname, "..", "..", "assets", "sfx", "reactions");

// From output/2026-05-16/huong-dan-cau-hinh-claude-xay-kenh-marketing-mien-/video/index.html
// (authored correctly by a human via Claude Code + /hyperframes in an earlier session)
// — trimmed to the <body> essentials so the prompt stays focused on structure, not CSS.
const WORKED_EXAMPLE = `<div id="root" data-composition-id="main" data-start="0" data-duration="29" data-width="1080" data-height="1920">
  <!-- Atmosphere: tracks 0–6, full duration -->
  <div id="bg-dots"      class="clip bg-dots"      data-start="0" data-duration="29" data-track-index="0"></div>
  <div id="bg-glow"      class="clip bg-glow"      data-start="0" data-duration="29" data-track-index="1"></div>
  <div id="bg-scanlines" class="clip bg-scanlines" data-start="0" data-duration="29" data-track-index="2"></div>
  <div id="corner-tl"    class="clip corner corner-tl" data-start="0" data-duration="29" data-track-index="3"></div>
  <div id="corner-tr"    class="clip corner corner-tr" data-start="0" data-duration="29" data-track-index="4"></div>
  <div id="corner-bl"    class="clip corner corner-bl" data-start="0" data-duration="29" data-track-index="5"></div>
  <div id="corner-br"    class="clip corner corner-br" data-start="0" data-duration="29" data-track-index="6"></div>

  <!-- Music: track 20 -->
  <audio id="bg-music" class="clip" data-start="0" data-duration="29" data-track-index="20" data-volume="0.18" src="assets/music/upbeat-tech.mp3"></audio>

  <!-- Voiceover: track 21, data-start = the SAME crossfade-adjusted start as its scene -->
  <audio id="vo-01" class="clip" data-start="0.0"  data-duration="2.6" data-track-index="21" data-volume="1.0" src="assets/audio/scene_01_vo.mp3"></audio>
  <audio id="vo-02" class="clip" data-start="2.6"  data-duration="5.3" data-track-index="21" data-volume="1.0" src="assets/audio/scene_02_vo.mp3"></audio>
  <audio id="vo-03" class="clip" data-start="7.9"  data-duration="7.3" data-track-index="21" data-volume="1.0" src="assets/audio/scene_03_vo.mp3"></audio>

  <!-- Scenes: tracks 10/11 alternating, data-start crossfades 0.3s into the previous scene -->
  <div id="scene-01" class="clip" data-composition-id="scene-01" data-composition-src="compositions/scene_01.html" data-start="0"    data-duration="2.9" data-track-index="10" data-width="1080" data-height="1920"></div>
  <div id="scene-02" class="clip" data-composition-id="scene-02" data-composition-src="compositions/scene_02.html" data-start="2.6"  data-duration="5.6" data-track-index="11" data-width="1080" data-height="1920"></div>
  <div id="scene-03" class="clip" data-composition-id="scene-03" data-composition-src="compositions/scene_03.html" data-start="7.9"  data-duration="7.6" data-track-index="10" data-width="1080" data-height="1920"></div>
</div>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  tl.from('#bg-dots', { opacity: 0, duration: 1.2, ease: 'power2.out' }, 0);
  // ... other atmosphere entrances ...

  // Crossfade: fade out right as the NEXT scene's voiceover starts, hard-kill 0.3s later
  tl.to('#scene-01',  { opacity: 0, duration: 0.3, ease: 'power2.inOut' }, 2.6);
  tl.set('#scene-01', { opacity: 0 }, 2.9);
  tl.to('#scene-02',  { opacity: 0, duration: 0.3, ease: 'power2.inOut' }, 7.9);
  tl.set('#scene-02', { opacity: 0 }, 8.2);

  window.__timelines['main'] = tl;
</script>`;

function findingKey(f) {
  return `${f.code}::${f.message}`;
}

function diffNewFindings(baseline, current) {
  const baseKeys = new Set((baseline?.findings ?? []).map(findingKey));
  return (current.findings ?? []).filter((f) => !baseKeys.has(findingKey(f)));
}

// "SFX cuối scene" (user request) — the reaction sound needs a dedicated slot
// strictly AFTER a scene's voice/captions end, and the NEXT scene must not begin
// crossfading until that sound finishes. `sfxByScene` (built by routes.mjs from
// video-plan.json's per-scene `sfxFile`/`sfxDuration` — see build-footage-plan.mjs's
// applySceneSfx) maps sceneId -> {file, duration}; 0 for any scene without one.
function sfxGapFor(sceneId, sfxByScene) {
  return sfxByScene?.[sceneId]?.duration ?? 0;
}

/** Same crossfade formula the prompt asks the LLM to compute
 *  (`data-start[i] = data-start[i-1] + scene_duration[i-1] - 0.3`), done once in code
 *  as ground truth — `doneScenes` must be in the same order the LLM was told to
 *  use them (narrative order, per scenesWithTiming.scenes).
 *
 *  A scene with a trailing SFX gap does NOT get the usual 0.3s crossfade overlap —
 *  user requirement: the reaction sound must fully finish before the NEXT scene
 *  starts, not just before the current one's voice does. Applying the normal -0.3
 *  here would let scene i+1 start fading in while the SFX is still audible (confirmed
 *  via a dry-run of this exact formula: a 1.2s SFX ending at 5.2s but the next scene
 *  starting at 4.9s). So: no gap → normal 0.3s crossfade; gap → next scene waits for
 *  the SFX to fully end, THEN gets its own fresh crossfade in from there. */
function crossfadeStarts(doneScenes, sfxByScene) {
  const starts = [0];
  for (let i = 1; i < doneScenes.length; i++) {
    const prevGap = sfxGapFor(doneScenes[i - 1].sceneId, sfxByScene);
    const prevEnd = starts[i - 1] + doneScenes[i - 1]._audio.scene_duration + prevGap;
    starts.push(Math.round((prevGap > 0 ? prevEnd : prevEnd - 0.3) * 1000) / 1000);
  }
  return starts;
}

function computeTotalDuration(doneScenes, sfxByScene) {
  const starts = crossfadeStarts(doneScenes, sfxByScene);
  const lastIdx = doneScenes.length - 1;
  const lastGap = sfxGapFor(doneScenes[lastIdx].sceneId, sfxByScene);
  return Math.round((starts[lastIdx] + doneScenes[lastIdx]._audio.scene_duration + lastGap) * 1000) / 1000;
}

/**
 * Same "code writes structural fields, never trust the LLM to echo them" fix as
 * enforceVoiceoverTags/enforceSceneTiming — found live via user report: real audio
 * showed a duplicated voice, one loud + one quiet (~20% volume, ~0.1s drift). Root
 * cause: the shared workspace `assets/music/` library shipped empty (see
 * scene-timing-assembler.mjs's own comment), so the model — given a `music_track`
 * path that doesn't actually exist on disk — hallucinated a DIFFERENT, real file it
 * found instead: the raw uploaded source recording (`assets/source/source.<ext>`,
 * audio-import.mjs's own input). That file is the WHOLE original narration, so it
 * played a second time start-to-finish as "background music" under the real
 * per-scene-cut voiceover — same speech, slightly out of sync because one copy is
 * cut into scene clips and the other isn't. `music_track`/`music_volume` are both
 * 100% deterministic from scenesWithTiming._audio — no reason to leave the tag's
 * `src`/`data-volume` to the model either.
 */
function enforceMusicTag(html, musicTrack, musicVolume, totalDuration) {
  // ["']20["'] (not a hard-coded double quote) — same class of bug as
  // enforceSceneTiming's tween-stripper below: an HTML attribute written with
  // single quotes (`data-track-index='20'`) would silently fail to match a
  // double-quote-only pattern, leaving a stray old tag behind. Not yet observed
  // for HTML attributes specifically (unlike the JS tween case, which was), but
  // it's the identical failure mode, so hardened proactively rather than waiting
  // for it to burn another few hundred k tokens before anyone notices.
  const withoutOldMusic = html.replace(/[ \t]*<audio\b[^>]*data-track-index=["']20["'][^>]*>\s*<\/audio>\n?/g, "");
  if (!musicTrack) return withoutOldMusic;
  const tag = `    <audio id="bg-music" class="clip" data-start="0" data-duration="${totalDuration}" data-track-index="20" data-volume="${musicVolume}" src="${musicTrack}"></audio>`;
  const voMarker = withoutOldMusic.search(/<audio\b[^>]*data-track-index=["']21["']/);
  const sceneMarker = withoutOldMusic.search(/<div[^>]*data-composition-src=/);
  const insertAt = voMarker !== -1 ? voMarker : sceneMarker;
  if (insertAt === -1) return withoutOldMusic;
  return withoutOldMusic.slice(0, insertAt) + tag + "\n\n    " + withoutOldMusic.slice(insertAt);
}

function buildVoiceoverBlock(doneScenes, sfxByScene) {
  const starts = crossfadeStarts(doneScenes, sfxByScene);
  return doneScenes
    .map((s, i) => {
      if (!s._audio?.voiceover) return null;
      const num = s.sceneId.replace(/^scene_?/, "");
      return `    <audio id="vo-${num}" class="clip" data-start="${starts[i]}" data-duration="${s._audio.vo_duration}" data-track-index="21" data-volume="1.0" src="${s._audio.voiceover}"></audio>`;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Strips whatever track-21 `<audio>` tags the LLM wrote and replaces them with the
 * code-computed ground truth in one deterministic pass — same "code writes
 * structural fields, never trust the LLM to echo them" pattern already used for
 * `template`/`subStyle` elsewhere in this codebase (see video-planner.mjs). Added
 * after confirming live that even an explicit checklist in the prompt (listing
 * every required `vo-XX` id) didn't reliably work: across repeated retries the
 * model kept dropping a DIFFERENT subset of voiceover tags each time — a
 * whack-a-mole pattern where fixing the reported findings broke previously-correct
 * ones, never converging within maxFixAttempts on a real 6-scene project. Voiceover
 * data-start/data-duration/src are 100% deterministic from `doneScenes`, so there's
 * no reason to keep gambling on the LLM getting the enumeration right.
 */
function enforceVoiceoverTags(html, doneScenes, sfxByScene) {
  const correctBlock = buildVoiceoverBlock(doneScenes, sfxByScene);
  // Same quote-agnostic hardening as enforceMusicTag above.
  const withoutOldVo = html.replace(/[ \t]*<audio\b[^>]*data-track-index=["']21["'][^>]*>\s*<\/audio>\n?/g, "");
  const marker = withoutOldVo.search(/<div[^>]*data-composition-src=/);
  if (marker === -1 || !correctBlock) return withoutOldVo;
  return withoutOldVo.slice(0, marker) + correctBlock + "\n\n    " + withoutOldVo.slice(marker);
}

function buildSceneBlock(doneScenes, width, height, sfxByScene) {
  const starts = crossfadeStarts(doneScenes, sfxByScene);
  return doneScenes
    .map((s, i) => {
      const num = s.sceneId.replace(/^scene_?/, "");
      const track = i % 2 === 0 ? 10 : 11;
      // Extended by this scene's own trailing SFX gap (0 if none) — the footage clip
      // itself was cut this much longer (see footage-scene-writer.mjs), so the host
      // div's own visibility window must match or the clip would go blank/hidden
      // during the reaction sound instead of continuing to roll under it.
      const duration = Math.round((s._audio.scene_duration + sfxGapFor(s.sceneId, sfxByScene)) * 1000) / 1000;
      return `    <div id="scene-${num}" class="clip" data-composition-id="scene-${num}" data-composition-src="compositions/scene_${num}.html" data-start="${starts[i]}" data-duration="${duration}" data-track-index="${track}" data-width="${width}" data-height="${height}"></div>`;
    })
    .join("\n");
}

function buildCrossfadeScript(doneScenes, sfxByScene) {
  const starts = crossfadeStarts(doneScenes, sfxByScene);
  const lines = [];
  for (let i = 0; i < doneScenes.length - 1; i++) {
    const num = doneScenes[i].sceneId.replace(/^scene_?/, "");
    const fadeStart = starts[i + 1];
    const hardKill = Math.round((fadeStart + 0.3) * 1000) / 1000;
    lines.push(`    tl.to('#scene-${num}', { opacity: 0, duration: 0.3, ease: 'power2.inOut' }, ${fadeStart});`);
    lines.push(`    tl.set('#scene-${num}', { opacity: 0 }, ${hardKill});`);
  }
  return lines.join("\n");
}

/**
 * Same "code writes structural fields, never trust the LLM" fix as
 * enforceVoiceoverTags, for the OTHER half of the same crossfade math — found live
 * via a user report: narration cut off before finishing, "chưa hết câu đã chuyển
 * cảnh" (scene changes before the sentence ends), worse on later scenes. Root cause
 * confirmed on a real broken index.html: the model computed `vo-*` audio
 * `data-start` correctly with the crossfade formula (`prev_start + prev_scene_
 * duration - 0.3`), but computed the SCENE `<div>` `data-start` (and the matching
 * crossfade `tl.to`/`tl.set` trigger times) as a plain running sum of raw
 * `vo_duration` instead — no `-0.3` crossfade offset, no `scene_duration` (which
 * includes generate-audio.mjs's +0.5s buffer). The drift compounds every scene
 * (0.2s, 0.4s, 0.6s, 0.8s late by scene 5 in the reported project), so each scene's
 * fade-out/hard-kill fires earlier and earlier relative to when its own voiceover
 * actually finishes playing. Both numbers are 100% deterministic from the same
 * `doneScenes` data enforceVoiceoverTags already uses — no reason to leave either to
 * the model.
 */
function enforceSceneTiming(html, doneScenes, width, height, sfxByScene) {
  // Must run AFTER enforceVoiceoverTags — relies on the voiceover block already
  // being correct and sitting immediately before where the scene divs used to be
  // (that's where the LLM always writes them), so inserting right after the LAST
  // voiceover <audio> tag lands scenes back in the same spot without guessing at
  // generic HTML structure.
  const sceneBlock = buildSceneBlock(doneScenes, width, height, sfxByScene);
  // Same quote-agnostic hardening as enforceMusicTag/enforceVoiceoverTags above —
  // backreference so `data-composition-src='compositions/scene_01.html'` (single
  // quotes) is stripped just as reliably as the double-quoted form.
  const withoutOldScenes = html.replace(/[ \t]*<div\b[^>]*data-composition-src=(["'])compositions\/scene_[^"']*\.html\1[^>]*>\s*<\/div>\n?/g, "");
  const audioMatches = [...withoutOldScenes.matchAll(/<audio\b[^>]*data-track-index=["']21["'][^>]*>\s*<\/audio>\n?/g)];
  const insertAt = audioMatches.length
    ? audioMatches[audioMatches.length - 1].index + audioMatches[audioMatches.length - 1][0].length
    : withoutOldScenes.search(/<\/div>\s*\n\s*<\/div>/);
  const withScenes =
    insertAt === -1 || !sceneBlock ? withoutOldScenes : withoutOldScenes.slice(0, insertAt) + "\n" + sceneBlock + "\n" + withoutOldScenes.slice(insertAt);

  const crossfadeScript = buildCrossfadeScript(doneScenes, sfxByScene);
  // Found live (user report): the model doesn't always match the worked example's
  // single-quote style for the selector string — when it wrote `tl.to("#scene-01",
  // ...)` (double quotes), this regex's single-quote-only pattern silently failed to
  // match it, so the OLD (LLM-authored) tween never got stripped before the NEW
  // (code-computed) one was inserted — leaving both in the file, tripping lint's
  // overlapping_gsap_tweens on every scene and never converging across retries
  // (the model kept regenerating the same double-quoted style each attempt). Quote
  // character captured as a backreference so either style is matched and removed.
  const withoutOldTweens = withScenes.replace(/[ \t]*tl\.(to|set)\((['"])#scene-[^'"]+\2,[^;]*\);\n?/g, "");
  const tlMarker = withoutOldTweens.search(/const tl = gsap\.timeline\([^)]*\);\n?/);
  if (tlMarker === -1 || !crossfadeScript) return withoutOldTweens;
  const afterTlLine = withoutOldTweens.indexOf("\n", tlMarker) + 1;
  return withoutOldTweens.slice(0, afterTlLine) + "\n" + crossfadeScript + "\n" + withoutOldTweens.slice(afterTlLine);
}

/**
 * Same class of bug as enforceSceneTiming — the root composition's total
 * `data-duration` (shared by `#root`, the 7 atmosphere elements, and the music
 * track, per this project's own convention) is another value the model computes by
 * summing scene durations itself instead of it being handed a ground truth. Found
 * live while investigating the crossfade bug above: the SAME broken project had
 * root `data-duration="29.41"` when the correct total (last scene's crossfade start
 * + its own scene_duration) is `28.37` — atmosphere/music running ~1s past when the
 * last scene actually ends. Scoped replace is safe here because by the time this
 * runs, scene/voiceover durations have already been corrected to their own distinct
 * per-scene values (see enforceSceneTiming/enforceVoiceoverTags above) — the OLD
 * total is the only remaining occurrence of that exact number in the file.
 */
function enforceTotalDuration(html, doneScenes, sfxByScene) {
  const correctTotal = computeTotalDuration(doneScenes, sfxByScene);
  const rootMatch = html.match(/<div id="root"[^>]*data-duration="([\d.]+)"/);
  if (!rootMatch) return html;
  const oldTotal = rootMatch[1];
  if (oldTotal === String(correctTotal)) return html;
  const re = new RegExp(`data-duration="${oldTotal.replace(/\./g, "\\.")}"`, "g");
  return html.replace(re, `data-duration="${correctTotal}"`);
}

/**
 * Optional "cười/vỗ tay cuối mỗi scene" feature (user request) — never involves the
 * LLM at all. `sfxByScene` is decided up front by build-footage-plan.mjs's
 * applySceneSfx (persisted on video-plan.json, read by routes.mjs), NOT picked here —
 * this function only PLACES the already-chosen file. It plays in its own slot right
 * after the scene's voice/captions end (never overlapping the last word — the footage
 * clip itself was cut this much longer, see footage-scene-writer.mjs), and
 * crossfadeStarts() already pushed every later scene back to wait for it to finish.
 * Silently no-ops (returns html with old tags stripped, nothing added) if
 * `sfxByScene` is empty. All reaction tags share ONE track (40) — they never overlap
 * in time by construction, same reasoning karaoke caption chunks reuse one track for.
 */
function enforceSfxTags(html, doneScenes, projectDir, sfxByScene) {
  // These ids are only ever written by THIS function (the LLM is never told about
  // this feature) — stripping on every attempt just makes a rerun idempotent, no
  // quote-style hardening needed unlike the other enforce* functions above.
  const withoutOld = html.replace(/[ \t]*<audio\b[^>]*\bid=["']sfx-reaction-[^>][^>]*>\s*<\/audio>\n?/g, "");
  if (!sfxByScene || !Object.keys(sfxByScene).length) return withoutOld;

  const destDir = join(projectDir, "assets", "sfx", "reactions");
  mkdirSync(destDir, { recursive: true });

  const starts = crossfadeStarts(doneScenes, sfxByScene);
  const tags = [];
  for (let i = 0; i < doneScenes.length; i++) {
    const s = doneScenes[i];
    const pick = sfxByScene[s.sceneId];
    if (!pick) continue;
    const srcPath = join(SFX_REACTION_DIR, pick.file);
    if (!existsSync(srcPath)) continue; // removed from the pool since the plan was built — skip gracefully
    const destPath = join(destDir, pick.file);
    if (!existsSync(destPath)) copyFileSync(srcPath, destPath);

    // Right after the scene's own voice/captions portion — the footage clip was
    // already cut long enough to cover this, so no overlap and no clamping needed.
    const start = Math.round((starts[i] + s._audio.scene_duration) * 1000) / 1000;
    const num = s.sceneId.replace(/^scene_?/, "");
    tags.push(
      `    <audio id="sfx-reaction-${num}" class="clip" data-start="${start}" data-duration="${pick.duration}" data-track-index="40" data-volume="0.9" src="assets/sfx/reactions/${pick.file}"></audio>`
    );
  }
  if (!tags.length) return withoutOld;

  // Land right after the LAST scene div's closing tag — same spot enforceSceneTiming
  // itself just finished inserting the scene block, so this always lines up.
  const sceneMatches = [...withoutOld.matchAll(/<div\b[^>]*data-composition-src=(["'])compositions\/scene_[^"']*\.html\1[^>]*>\s*<\/div>/g)];
  if (!sceneMatches.length) return withoutOld;
  const last = sceneMatches[sceneMatches.length - 1];
  const insertAt = last.index + last[0].length;
  return withoutOld.slice(0, insertAt) + "\n" + tags.join("\n") + withoutOld.slice(insertAt);
}

/**
 * @param {object} params
 * @param {string} params.projectDir
 * @param {string} params.design - DESIGN.md content
 * @param {object} params.scenesWithTiming - parsed scenes-with-timing.json
 * @param {string[]} params.doneSceneIds - sceneIds whose sub-composition already
 *   passed scene-writer successfully; the caller (routes.mjs) is responsible for
 *   filtering this from job-status — root-composer only ever wires exactly these.
 * @param {string} params.format - video-plan.json's top-level `format` ("9:16" |
 *   "16:9"). Confirmed live this was missing entirely: with no dimension guidance,
 *   root-composer defaulted every data-width/data-height in index.html (root AND
 *   every scene host) to 1920x1080 regardless of the project's actual format,
 *   squeezing correctly-authored 1080x1920 scenes into a landscape host — content
 *   bunched in a corner, text overlapping, and the final render came out landscape
 *   even though the project was created as portrait.
 * @param {string} [params.template] - video-plan.json's `template` ("motion" | "sub").
 *   Root-composer always receives the WORKSPACE's own DESIGN.md, which is the
 *   neon-green dark-tech palette for the default "motion" style — it has nothing to
 *   do with "sub" (image_full_focus) scenes, which are warm full-bleed AI images
 *   authored entirely outside the LLM (see templates/sub-styles/image-full-focus.mjs).
 *   Confirmed live via user screenshot: without this override the model still drew
 *   DESIGN.md's neon-green corner brackets/dots/scanlines on top of a warm peach
 *   "sub" scene, clashing badly. When template is "sub", tell it to skip the
 *   atmosphere layer entirely instead of trying to reconcile two unrelated palettes.
 */
export async function runRootComposer({
  projectDir,
  design,
  scenesWithTiming,
  doneSceneIds,
  format,
  template,
  // "SFX cuối scene" — sceneId -> {file, duration}, already decided by
  // build-footage-plan.mjs's applySceneSfx (not picked here, see enforceSfxTags'
  // own doc comment). Built by routes.mjs from videoPlan.scenes; empty object for
  // any project that doesn't use it.
  sfxByScene = {},
  model = CHEAP_MODEL,
  // Was 8 — confirmed live that's too tight: the model spent 6 of 8 turns re-reading
  // index.html/compositions/*.html/assets/* via read_file/list_dir even though all
  // of that is already inlined in the prompt (see the "KHÔNG gọi read_file" note
  // above), leaving only 2 turns for write_file and hitting the cap before it could
  // send a final non-tool-call message. The prompt now explicitly tells it not to
  // re-read; this bump is just a safety margin on top of that fix.
  maxTurns = 12,
  maxFixAttempts = 3,
  onEvent,
  signal,
}) {
  if (!doneSceneIds?.length) {
    throw new Error("No successfully generated scenes to compose into root index.html");
  }

  const skill = readFileSync(SKILL_PATH, "utf-8");
  const tools = createFsTools(projectDir);
  const { width, height } = dimensionsForFormat(format);

  const doneScenes = (scenesWithTiming.scenes ?? []).filter((s) => doneSceneIds.includes(s.sceneId));
  const scenesWithVoiceover = doneScenes.filter((s) => s._audio?.voiceover).map((s) => s.sceneId);

  // "sub" scenes (image_full_focus) are warm full-bleed AI images with their own
  // gradient/shade, hardcoded outside the LLM — they have nothing to do with the
  // workspace's own DESIGN.md (neon-green dark-tech, meant for "motion" scenes).
  // Confirmed live via screenshot: leaving the atmosphere bullet unconditional made
  // the model still draw DESIGN.md's neon corner brackets/dots on top of a "sub"
  // scene. Skip the whole atmosphere layer for "sub" instead of asking the model to
  // reconcile two unrelated palettes. "footage" scenes are real stock-footage clips
  // (footage-style.mjs) — same reasoning applies, just never wired up when that
  // template was added (found via code review, not a user report this time).
  const atmosphereInstruction =
    template === "sub" || template === "footage"
      ? `- KHÔNG thêm atmosphere layer (bg-dots, bg-glow, scanlines, 4 góc...). DESIGN.md
  bên dưới là palette neon-green mặc định của workspace, dùng cho style "motion" —
  KHÔNG áp dụng cho scene "${template}" (${template === "sub" ? "ảnh AI full-bleed đã có gradient/shade riêng" : "video thật full-bleed đã có shade riêng"}, tự
  authored ngoài LLM). Root composition chỉ cần: scene clips + music + voiceover.`
      : `- Atmosphere (bg-dots, bg-glow, scanlines, 4 góc...) — \`data-track-index\` 0–6,
  \`data-start="0"\`, \`data-duration\` = tổng thời lượng toàn video (tổng \`scene_duration\`
  của các scene được ghép, tính crossfade — xem cách tính bên dưới)`;

  const systemPrompt = `${skill}

---

Bạn đang viết ROOT composition (\`index.html\` ở gốc project), KHÔNG phải sub-composition.
Đây là override bắt buộc riêng của project này (cao hơn hướng dẫn chung ở trên), theo
đúng "Conventions Bắt Buộc" trong CLAUDE.md:

${atmosphereInstruction}
- Background music — \`data-track-index="20"\`, thẻ \`<audio>\`, \`data-volume\` lấy từ
  \`music_volume\` cho sẵn trong dữ liệu
- Voiceover mỗi scene — \`data-track-index="21"\` (dùng lại track, KHÔNG overlap thời
  gian), \`data-start\` = ĐÚNG BẰNG \`data-start\` của scene tương ứng (đã tính crossfade —
  xem bên dưới), \`data-duration\` = đúng \`vo_duration\` của scene đó (KHÔNG cộng buffer
  0.5s). LƯU Ý: field \`voiceover_start\` trong dữ liệu scenes-with-timing.json là mốc
  tích luỹ CHƯA áp dụng crossfade — không dùng thẳng field đó, phải tự tính lại theo
  quy tắc crossfade bên dưới.
- BẮT BUỘC viết ĐỦ ĐÚNG ${scenesWithVoiceover.length} thẻ \`<audio>\` track 21, đúng
  danh sách id sau, KHÔNG được thiếu bất kỳ cái nào (đã xác nhận thật: model hay bỏ sót
  1 vài id giữa chừng khi có nhiều scene, nhất là khi sửa lại theo lỗi lint — mỗi lần
  sửa phải kiểm tra lại ĐỦ cả danh sách này, không chỉ sửa đúng cái lỗi vừa báo rồi bỏ
  quên cái khác đã đúng trước đó): ${scenesWithVoiceover.map((s) => `vo-${s.replace(/^scene_?/, "")}`).join(", ")}
- Scene clips — \`<div class="clip" data-composition-id="scene-NN" data-composition-src="compositions/scene_NN.html">\`,
  xen kẽ \`data-track-index\` 10/11, \`data-duration\` = đúng \`scene_duration\` cho sẵn (đã
  gồm buffer 0.5s, KHÔNG tự đổi)
- Cách tính \`data-start\` có crossfade: scene đầu tiên \`data-start="0"\`. Mỗi scene sau
  bắt đầu sớm hơn 0.3s so với thời điểm scene liền trước "hết hạn"
  (\`data-start[i] = data-start[i-1] + scene_duration[i-1] - 0.3\`)
- Crossfade GSAP: tại đúng thời điểm scene sau bắt đầu, \`tl.to('#scene-i', {opacity:0,
  duration:0.3, ease:'power2.inOut'}, <thời điểm đó>)\`, rồi \`tl.set('#scene-i',
  {opacity:0}, <thời điểm đó + 0.3>)\` để hard-kill ngay sau khi fade xong (scene cuối
  cùng không cần crossfade fade-out)
- CHỈ ghép ĐÚNG danh sách scene cho sẵn bên dưới (đã lọc — chỉ gồm scene generate thành
  công qua bước trước), bỏ qua mọi scene khác dù video-plan.json có liệt kê
- \`repeat: Math.ceil(...)\` — KHÔNG BAO GIỜ dùng \`repeat: -1\`
- Mỗi scene trong \`compositions/scene_NN.html\` LUÔN có \`data-composition-id="scene-NN"\`
  (đúng số thứ tự trong tên file, số 0 ở đầu nếu có — quy ước bắt buộc, do chính
  scene-writer tạo ra) — KHÔNG cần \`read_file\` để kiểm tra lại, cứ dùng đúng
  \`data-composition-id\`/\`data-composition-src\` theo \`sceneId\` cho sẵn trong danh sách
  scene bên dưới
- Kích thước canvas của TOÀN BỘ project là \`data-width="${width}" data-height="${height}"\`
  — dùng ĐÚNG 2 số này cho MỌI \`data-width\`/\`data-height\` trong file: cả \`<div id="root">\`
  gốc LẪN từng scene host (\`<div data-composition-src="compositions/scene_NN.html">\`).
  KHÔNG tự đoán, KHÔNG lấy số từ ví dụ bên dưới (ví dụ chỉ minh hoạ cấu trúc, số liệu
  của nó có thể khác project này) — mọi scene đã được scene-writer viết đúng theo
  ${width}×${height}, nếu root/scene-host dùng số khác thì nội dung sẽ bị co/tràn khi
  ghép, và video render ra sẽ sai hướng (ngang/dọc) so với lựa chọn của user.
- TUYỆT ĐỐI KHÔNG tự viết CSS rule cho class \`.clip\` (ví dụ \`.clip { position: absolute;
  ... }\`) trong \`<style>\`. \`class="clip"\` là marker riêng của framework để tự quản lý
  hiện/ẩn theo thời gian — tự định nghĩa CSS cho nó (nhất là \`position\`) sẽ phá cách
  framework mount kích thước cho scene host, khiến nội dung bên trong mỗi scene bị co
  lại thành 1 khối nhỏ và dồn lên góc trên, chữ chồng lên nhau (đã xác nhận bằng test
  thật: chỉ cần xoá đúng rule này là hết lỗi, không cần đổi gì khác). Nếu cần định vị
  atmosphere layers (bg-dots, bg-glow...), dùng class riêng của bạn (\`.bg-dots\`,
  \`.corner-tl\`...) với \`position: absolute\`, KHÔNG đặt lên \`.clip\`.

DESIGN.md, danh sách scene (kèm đủ \`vo_duration\`/\`scene_duration\`/đường dẫn audio), và
tên nhạc nền ĐÃ được nhúng đầy đủ trong user message bên dưới — KHÔNG gọi \`read_file\`
hay \`list_dir\` để kiểm tra lại các thông tin này, chỉ lãng phí lượt gọi. Chỉ cần
\`write_file\` để ghi \`index.html\`.

Ví dụ 1 root index.html đã viết đúng (project khác, chỉ để tham khảo CẤU TRÚC — số liệu
khác nhau, đừng copy số, chỉ copy cách tổ chức track/crossfade):

\`\`\`html
${WORKED_EXAMPLE}
\`\`\`

Bạn đang chạy tự động (non-interactive). Dùng tool \`write_file\` để lưu đúng 1 file vào
project root (path tương đối, không tiền tố project): \`index.html\`. Sau khi ghi xong,
trả lời bằng 1 câu tóm tắt — không tool call nào nữa.`;

  const basePrompt = [
    `DESIGN.md:\n${design}`,
    `Danh sách scene cần ghép (đã lọc, chỉ scene generate thành công), mỗi scene có sẵn
\`_audio.vo_duration\`, \`_audio.scene_duration\`, \`_audio.voiceover\` (đường dẫn mp3):\n${JSON.stringify(doneScenes, null, 2)}`,
    `Nhạc nền: ${scenesWithTiming._audio?.music_track ?? "(không có)"}, volume ${scenesWithTiming._audio?.music_volume ?? 0.18}`,
  ].join("\n\n---\n\n");

  const baseline = await lint(projectDir);
  let lastNewFindings = [];
  let previousFindingKeys = null;
  let stuck = false;
  let agentResult;
  // See run-agent.mjs's priorMessages doc + scene-writer.mjs's identical pattern —
  // carries the conversation across fix attempts so retries only send the new lint
  // findings, not skill + worked example + scene data again (~8.4k tokens/attempt).
  let priorMessages = null;
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 };
  const addUsage = (u) => {
    if (!u) return;
    usage.promptTokens += u.promptTokens ?? 0;
    usage.completionTokens += u.completionTokens ?? 0;
    usage.totalTokens += u.totalTokens ?? 0;
    usage.apiCalls += u.apiCalls ?? 0;
  };

  for (let attempt = 0; attempt <= maxFixAttempts; attempt++) {
    const userPrompt =
      attempt === 0
        ? basePrompt
        : `Lần viết trước (attempt ${attempt}) có lỗi lint MỚI (không tính lỗi có sẵn của project):\n${JSON.stringify(lastNewFindings, null, 2)}\n\nSửa lại đúng file index.html để hết các lỗi này. Không giải thích — sửa trực tiếp.`;

    try {
      // stopAfterWrites: 1 — same fix as scene-writer.mjs (same architecture, same
      // observed risk of looping on write_file past the point the task is done).
      agentResult = await runAgent({ systemPrompt, userPrompt, tools, model, maxTurns, onEvent, priorMessages, stopAfterWrites: 1, signal });
    } catch (err) {
      addUsage(err.usage);
      err.usage = { ...usage };
      throw err;
    }
    priorMessages = agentResult.messages;
    addUsage(agentResult.usage);

    const indexPath = join(projectDir, "index.html");
    const rawHtml = readFileSync(indexPath, "utf-8");
    // Force-correct the voiceover block before validating anything else — see
    // enforceVoiceoverTags' doc comment for why this isn't left to the retry loop.
    // Applied (and re-written to disk) on EVERY attempt, not just the last, so lint
    // and the other checks below always see the corrected version, and a project
    // that fails for some OTHER reason still ends up with correct audio in the
    // partially-failed file on disk.
    const totalDuration = computeTotalDuration(doneScenes, sfxByScene);
    const withMusic = enforceMusicTag(rawHtml, scenesWithTiming._audio?.music_track, scenesWithTiming._audio?.music_volume ?? 0.18, totalDuration);
    const withVoiceover = enforceVoiceoverTags(withMusic, doneScenes, sfxByScene);
    const withSceneTiming = enforceSceneTiming(withVoiceover, doneScenes, width, height, sfxByScene);
    const withTotalDuration = enforceTotalDuration(withSceneTiming, doneScenes, sfxByScene);
    const html = enforceSfxTags(withTotalDuration, doneScenes, projectDir, sfxByScene);
    if (html !== rawHtml) writeFileSync(indexPath, html);

    const current = await lint(projectDir);
    // Same reasoning as scene-writer.mjs's dimension check: hyperframes lint
    // validates each file in isolation, so it can never catch root/scene-host
    // dimensions disagreeing with the project's actual format. Hard-fail here
    // (folded into the same retry gate as lint), not just a warning, or nothing
    // actually forces the model to fix it. checkClipClassOverride catches the
    // confirmed real root cause of the "content bunched in a corner" bug — also a
    // hard-fail, since a lint-clean, correctly-dimensioned file can still render
    // broken if it has this rule. checkVoiceoverOverlap/Completeness should now
    // never actually fire (enforceVoiceoverTags guarantees both), kept as a
    // defense-in-depth assertion rather than removed.
    lastNewFindings = [
      ...diffNewFindings(baseline, current),
      ...checkAllCanvasDimensions(html, width, height),
      ...checkClipClassOverride(html),
      ...checkVoiceoverOverlap(html),
      ...checkVoiceoverCompleteness(html, scenesWithVoiceover),
    ];
    onEvent?.({ type: "lint", attempt, newFindingCount: lastNewFindings.length });

    if (lastNewFindings.length === 0) {
      const staticWarnings = checkPseudoElementAnimations(html);
      if (staticWarnings.length) onEvent?.({ type: "static-check", staticWarnings });
      return { ok: true, attempts: attempt + 1, agentResult, staticWarnings, usage };
    }

    // Found live (user report): a real 200k-token, 9-call retry run where the
    // SAME 8 findings recurred identically on every single attempt — the actual
    // bug turned out to be in the enforce* functions above (a quote-style regex
    // gap), not anything the model could fix through prompting, since the model
    // never sees the duplicate its OWN output triggers in code. Retrying against
    // an unchanging finding set can never converge; bail out early instead of
    // burning through the rest of maxFixAttempts on the same dead end — this is
    // a generic safety net for whatever the NEXT undiscovered enforce-function
    // gap turns out to be, not a fix for this specific bug (already fixed above).
    const currentFindingKeys = new Set(lastNewFindings.map(findingKey));
    if (previousFindingKeys && currentFindingKeys.size === previousFindingKeys.size && [...currentFindingKeys].every((k) => previousFindingKeys.has(k))) {
      onEvent?.({ type: "stuck", attempt, findingCount: lastNewFindings.length });
      stuck = true;
      break;
    }
    previousFindingKeys = currentFindingKeys;
  }

  return {
    ok: false,
    attempts: stuck ? undefined : maxFixAttempts + 1,
    newFindings: lastNewFindings,
    agentResult,
    usage,
    error: stuck
      ? `Lỗi lint không giảm giữa 2 lần thử liên tiếp (${lastNewFindings.length} lỗi, không đổi) — dừng sớm thay vì thử hết ${maxFixAttempts + 1} lần, vì nhiều khả năng đây là lỗi ở code enforce (xem root-composer.mjs), không phải thứ model có thể tự sửa qua prompt.`
      : undefined,
  };
}
