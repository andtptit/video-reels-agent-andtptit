/**
 * REST endpoints for the pipeline, one per CLAUDE.md step. Project state is always
 * the on-disk project dir (see project-id.mjs) — these routes are a thin HTTP shell
 * around the same agent/pipeline functions the CLI test scripts already exercise;
 * no logic is duplicated here.
 *
 * Every mutating route runs its work through job-status.runStep so progress is both
 * persisted (job-status.json) and streamable (GET /projects/:id/events, SSE).
 */
import { Router } from "express";
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, rmdirSync } from "fs";
import { join, resolve, relative, isAbsolute, sep, dirname } from "path";
import { execFile } from "child_process";
import { resolveProjectDir, toProjectId, listProjects, InvalidProjectIdError } from "./lib/project-id.mjs";
import { DEFAULT_MODEL, CHEAP_MODEL } from "./agents/run-agent.mjs";
import { createProject } from "./pipeline/new-project.mjs";
import { runGenerateAudio } from "./pipeline/generate-audio.mjs";
import { createRemixProject } from "./pipeline/remix-project.mjs";
import { runContentPlanner } from "./agents/content-planner.mjs";
import { runVideoPlanner } from "./agents/video-planner.mjs";
import { runRemixScenes } from "./agents/remix-scenes.mjs";
import { runSceneWriter } from "./agents/scene-writer.mjs";
import { runSubSceneWriter } from "./agents/sub-scene-writer.mjs";
import { runRootComposer } from "./agents/root-composer.mjs";
import { runCaptionWriter } from "./agents/caption-writer.mjs";
import { buildFootagePlan } from "./pipeline/build-footage-plan.mjs";
import { runFootageWriter } from "./agents/footage-scene-writer.mjs";
import { scanFootageLibrary } from "./lib/footage-library.mjs";
import { render } from "./tools/hyperframes-cli.mjs";
import { readJobStatus, runStep, getEmitter, emitProgress } from "./jobs/job-status.mjs";
import { queues } from "./jobs/queue.mjs";
import { ensurePreview, touchPreview, startIdleSweep } from "./jobs/preview.mjs";
import { listProfiles, saveProfile, deleteProfile } from "./lib/profiles.mjs";
import { createBatchDir, resolveBatchDir, InvalidBatchIdError } from "./lib/batch-id.mjs";
import { readIdeaHistory, appendIdeaHistory } from "./lib/idea-history.mjs";
import { runIdeaGenerator } from "./agents/idea-generator.mjs";
import { generateImage } from "./providers/image/dashscope-image.mjs";
import { cancelStep } from "./jobs/cancel-registry.mjs";

startIdleSweep();

// Checkpoint files the frontend is allowed to read back for review (step 2/4 of the
// pipeline in CLAUDE.md) — an explicit allowlist, not "any file", since :id/:name
// would otherwise let a client read arbitrary project files (assets, .env-adjacent
// config) through this route.
const READABLE_FILES = {
  "master_content.md": "text/markdown",
  "caption.md": "text/plain", // served as text, not markdown — meant to be copy-pasted verbatim, not rendered
  "scenes.json": "application/json",
  "scenes-with-timing.json": "application/json",
  "video-plan.json": "application/json",
  "DESIGN.md": "text/markdown",
  "index.html": "text/plain", // served as text for the checkpoint viewer, not rendered as HTML
};

export const router = Router();

function withProjectDir(req, res, next) {
  try {
    req.projectDir = resolveProjectDir(req.params.id);
  } catch (err) {
    if (err instanceof InvalidProjectIdError) return res.status(400).json({ error: err.message });
    return next(err);
  }
  if (!existsSync(req.projectDir)) return res.status(404).json({ error: `Project not found: ${req.params.id}` });
  next();
}

// Fire the step in the background (don't block the HTTP response on a multi-turn
// LLM job) — client polls job-status or subscribes to /events for the result.
function runInBackground(projectDir, step, taskFn) {
  runStep(projectDir, step, taskFn).catch(() => {
    /* already recorded as an error event by runStep — nothing left to do here */
  });
}

router.get("/projects", (req, res) => {
  res.json({ projects: listProjects() });
});

// Read-only introspection so `.env` changes can be confirmed without guessing —
// these are module-level consts resolved from process.env ONCE at server startup
// (Node caches `--env-file` values in memory; a `.env` edit only takes effect after
// an actual process restart), so this reflects exactly what the RUNNING process is
// using, not just what's currently in the file on disk.
router.get("/debug/models", (req, res) => {
  res.json({
    DEFAULT_MODEL,
    CHEAP_MODEL,
    DASHSCOPE_MODEL_IMAGE: process.env.DASHSCOPE_MODEL_IMAGE || "wan2.6-image",
  });
});

// Quick "test prompt" tool for tuning imageStylePrefix/model before committing to a
// full pipeline run — not scoped to a project (no destPath, nothing persisted to
// disk on our side). Returns the OSS image URL directly; it's signed and expires in
// 24h (see dashscope-image.mjs's own doc comment) which is plenty for a UI preview,
// so there's no need to download+store it like generateAndSaveImage does for real
// scene images.
router.post("/test-image", (req, res) => {
  const { prompt, imageStylePrefix, format, model } = req.body ?? {};
  if (!prompt?.trim()) return res.status(400).json({ error: "prompt is required" });
  const fullPrompt = imageStylePrefix?.trim() ? `${prompt.trim()}, ${imageStylePrefix.trim()}` : prompt.trim();
  queues.dashscope
    .run(() => generateImage({ prompt: fullPrompt, format: format || "9:16", ...(model ? { model } : {}) }))
    .then(({ imageUrl }) => res.json({ imageUrl, fullPrompt }))
    .catch((err) => res.status(500).json({ error: err.message }));
});

// Channel profiles — see lib/profiles.mjs doc comment. Not scoped under
// /projects/:id since a profile is reused across many projects, not tied to one.
router.get("/profiles", (req, res) => {
  res.json({ profiles: listProfiles() });
});

router.put("/profiles/:name", (req, res) => {
  try {
    res.json(saveProfile(req.params.name, req.body ?? {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/profiles/:slug", (req, res) => {
  deleteProfile(req.params.slug);
  res.status(204).end();
});

router.post("/profiles/:slug/idea-history", (req, res) => {
  try {
    res.status(201).json(appendIdeaHistory(req.params.slug, req.body ?? {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// "Hàng loạt" (Batch) tab — see agents/idea-generator.mjs and web/src/components/
// Batch.jsx. A batch dir (server/batches/{id}/) is a scratch working dir that only
// ever holds ideas.json + job-status.json — it is NEVER a real hyperframes project
// and is never visible to listProjects()/History. Approving ideas creates REAL
// projects through the completely unchanged POST /projects + POST /projects/:id/plan
// routes above, driven by the client (Batch.jsx), not by a new server-side route —
// see plan.md's "Hàng loạt" section for the full reasoning.
function withBatchDir(req, res, next) {
  try {
    req.batchDir = resolveBatchDir(req.params.id);
  } catch (err) {
    if (err instanceof InvalidBatchIdError) return res.status(400).json({ error: err.message });
    return next(err);
  }
  if (!existsSync(req.batchDir)) return res.status(404).json({ error: `Batch not found: ${req.params.id}` });
  next();
}

function readIdeasFile(batchDir) {
  const file = join(batchDir, "ideas.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf-8"));
}

router.post("/batches", (req, res) => {
  const { channelTheme, audience, count, profileSlug } = req.body ?? {};
  if (!channelTheme?.trim()) return res.status(400).json({ error: "channelTheme is required" });
  if (!audience?.trim()) return res.status(400).json({ error: "audience is required" });
  if (!profileSlug) return res.status(400).json({ error: "profileSlug is required — chọn 1 profile kênh trước" });

  const n = Math.min(Math.max(Number(count) || 10, 1), 30);
  const { id: batchId, dir: batchDir } = createBatchDir();
  const avoidList = readIdeaHistory(profileSlug, { limit: 30 }).map((h) => `${h.subTopic} — ${h.idea}`);

  writeFileSync(
    join(batchDir, "ideas.json"),
    JSON.stringify({ channelTheme, audience, requestedCount: n, profileSlug, avoidListUsed: avoidList, createdAt: new Date().toISOString(), ideas: [] }, null, 2)
  );

  runInBackground(batchDir, "ideate", (onEvent, signal) =>
    queues.dashscope.run(() => runIdeaGenerator({ batchDir, channelTheme, audience, count: n, avoidList, onEvent, signal }))
  );

  res.status(202).json({ batchId, step: "ideate", status: "running" });
});

router.get("/batches/:id", withBatchDir, (req, res) => {
  res.json({ id: req.params.id, status: readJobStatus(req.batchDir), ideas: readIdeasFile(req.batchDir) });
});

router.put("/batches/:id/ideas", withBatchDir, (req, res) => {
  const current = readIdeasFile(req.batchDir);
  if (!current) return res.status(400).json({ error: "ideas.json chưa tồn tại — chưa sinh ý tưởng xong" });
  const updated = { ...current, ideas: req.body?.ideas ?? current.ideas };
  writeFileSync(join(req.batchDir, "ideas.json"), JSON.stringify(updated, null, 2));
  res.json(updated);
});

router.get("/batches/:id/events", withBatchDir, (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const emitter = getEmitter(req.batchDir);
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  send({ type: "snapshot", status: readJobStatus(req.batchDir) });
  emitter.on("event", send);

  req.on("close", () => emitter.off("event", send));
});

router.post("/projects", (req, res) => {
  const { idea, orientation } = req.body ?? {};
  let result;
  try {
    result = createProject(idea, { orientation });
  } catch (err) {
    // createProject only throws for bad/missing input or an already-existing
    // project dir — both client errors, not server failures.
    return res.status(400).json({ error: err.message });
  }
  res.status(201).json({ id: toProjectId(result.projectDir), projectPath: result.projectPath, platform: result.platform });
});

router.get("/projects/:id", withProjectDir, (req, res) => {
  res.json({ id: req.params.id, status: readJobStatus(req.projectDir) });
});

// Aborts a currently-running step — see jobs/cancel-registry.mjs. Returns 404 if
// nothing is actually running under that exact step key (already finished, or never
// started); the frontend is expected to only show the Huỷ button while its own
// `status === "running"`, so a 404 here means the UI's view was stale (the step
// finished on its own a moment before the click landed), not a real error.
router.post("/projects/:id/cancel", withProjectDir, (req, res) => {
  const { step } = req.body ?? {};
  if (!step) return res.status(400).json({ error: "step is required" });
  const cancelled = cancelStep(req.projectDir, step);
  if (!cancelled) return res.status(404).json({ error: `No running job for step "${step}"` });
  res.json({ cancelled: true });
});

// Opens the project's folder in the OS file manager — only meaningful because this
// tool runs the server and the browser on the SAME machine (local personal use, no
// multi-tenant/remote deployment in scope); `execFile` (not `exec`) with the already
// path-traversal-validated `req.projectDir` as a literal argv element, never
// interpolated into a shell string, so there's no injection surface even though this
// spawns a real OS process.
function openInFileManager(dirPath) {
  return new Promise((resolvePromise, reject) => {
    const platform = process.platform;
    const cmd = platform === "darwin" ? "open" : platform === "win32" ? "explorer" : "xdg-open";
    execFile(cmd, [dirPath], (err) => {
      // Windows' `explorer.exe` is documented to often exit non-zero even when it
      // successfully opens the window — don't treat that as failure there.
      if (err && platform !== "win32") return reject(err);
      resolvePromise();
    });
  });
}

router.post("/projects/:id/open-folder", withProjectDir, async (req, res) => {
  try {
    await openInFileManager(req.projectDir);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Không mở được thư mục: ${err.message}` });
  }
});

// Permanently deletes a project — irreversible, includes any AI-generated images/
// audio/renders already paid for. The frontend is expected to make the user
// confirm explicitly before calling this (see History.jsx); this route itself does
// no additional confirmation since it's a plain REST DELETE.
router.delete("/projects/:id", withProjectDir, (req, res) => {
  try {
    rmSync(req.projectDir, { recursive: true, force: true });
    // Project layout is output/<date>/<slug>/video/ — clean up the now-empty
    // <slug>/ and <date>/ parents too so deleted projects don't leave empty husks
    // cluttering `output/` (and so a re-created project with the same idea/slug on
    // the same date doesn't hit new-project.mjs's "directory already exists" guard).
    const slugDir = dirname(req.projectDir);
    const dateDir = dirname(slugDir);
    try {
      if (existsSync(slugDir) && readdirSync(slugDir).length === 0) rmdirSync(slugDir);
    } catch {
      /* not empty or already gone — fine either way */
    }
    try {
      if (existsSync(dateDir) && readdirSync(dateDir).length === 0) rmdirSync(dateDir);
    } catch {
      /* same */
    }
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/projects/:id/files/:name", withProjectDir, (req, res) => {
  const { name } = req.params;
  const contentType = READABLE_FILES[name];
  if (!contentType) return res.status(400).json({ error: `Not readable: ${name}` });
  const file = join(req.projectDir, name);
  if (!existsSync(file)) return res.status(404).json({ error: `${name} not found` });
  res.type(contentType).send(readFileSync(file, "utf-8"));
});

router.post("/projects/:id/plan", withProjectDir, (req, res) => {
  const { idea, audience, platform, targetDuration, model } = req.body ?? {};
  if (!idea) return res.status(400).json({ error: "idea is required" });
  if (!audience) return res.status(400).json({ error: "audience is required" });

  runInBackground(req.projectDir, "plan", (onEvent, signal) =>
    queues.dashscope.run(() =>
      runContentPlanner({ idea, projectDir: req.projectDir, audience, platform, targetDuration, model, onEvent, signal })
    )
  );
  res.status(202).json({ step: "plan", status: "running" });
});

// Remix — clones a style="sub" project into a NEW project dir, reusing its AI images
// (the expensive part) unchanged and only rewriting narration via an LLM. See
// pipeline/remix-project.mjs (sync scaffolding) + agents/remix-scenes.mjs (the LLM
// call). `video-plan.json` is copied over as-is (patched with `fontFamily` if given)
// and marked "done" immediately since it's already valid — same for the synthetic
// "plan" step once runRemixScenes finishes — so the new project's Pipeline UI lands
// straight on "2. Audio" as the next actionable step, matching that content- and
// video-planning are already decided for a remix.
router.post("/projects/:id/remix", withProjectDir, (req, res) => {
  const { remixPrompt, fontFamily, model } = req.body ?? {};
  if (!remixPrompt?.trim()) return res.status(400).json({ error: "remixPrompt is required" });

  let created;
  try {
    created = createRemixProject({ sourceProjectDir: req.projectDir, remixIdea: remixPrompt, fontFamily });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  emitProgress(created.projectDir, { step: "video-plan", status: "done" });

  runInBackground(created.projectDir, "plan", (onEvent, signal) =>
    queues.dashscope.run(() =>
      runRemixScenes({ projectDir: created.projectDir, sourceScenes: created.sourceScenes, remixPrompt, model, onEvent, signal })
    )
  );

  res.status(201).json({ id: toProjectId(created.projectDir), sourceId: req.params.id, platform: created.platform });
});

// Lists the shared background-music library (assets/music/*.mp3) so the UI can
// offer a track picker instead of only the mood-based auto-pick — see
// generate-audio.mjs's `musicTrack` override.
router.get("/music-library", (req, res) => {
  const musicDir = join(resolve(import.meta.dirname, "..", "assets", "music"));
  if (!existsSync(musicDir)) return res.json({ tracks: [] });
  const tracks = readdirSync(musicDir)
    .filter((f) => f.endsWith(".mp3") && !f.startsWith("._"))
    .map((f) => f.replace(/\.mp3$/, ""));
  res.json({ tracks });
});

router.post("/projects/:id/audio", withProjectDir, (req, res) => {
  const { ttsProvider, ttsRate, ttsVoice, musicTrack, musicVolume } = req.body ?? {};
  // Bug found live (user report: scene 5/6 render with no voice and no captions):
  // this taskFn took no `onEvent` param, so runStep's onEvent was silently dropped
  // instead of reaching runGenerateAudio — every per-scene TTS error
  // (generate-audio.mjs's generateVoiceover catches and reports via onEvent, then
  // continues to the next scene so 1 bad scene doesn't kill the whole batch) had
  // nowhere to go. The step still resolved and got marked "done" even with 2 scenes
  // missing real audio/word-timestamps entirely. Every other route here threads
  // `(onEvent) => ...` through — this one just forgot to.
  runInBackground(req.projectDir, "audio", (onEvent, signal) =>
    queues.tts.run(() =>
      runGenerateAudio(req.projectDir, {
        ttsProvider,
        ttsRate,
        ttsVoice,
        musicTrack,
        // UI sends a 0-100 percent (see Pipeline.jsx) — generate-audio.mjs's
        // music_volume is 0-1, matching the convention already baked into every
        // rendered index.html's data-volume attribute.
        musicVolume: musicVolume !== undefined ? musicVolume / 100 : undefined,
        onEvent,
        signal,
      })
    )
  );
  res.status(202).json({ step: "audio", status: "running" });
});

router.post("/projects/:id/video-plan", withProjectDir, (req, res) => {
  const {
    visualStyle, template, subStyle, imageStylePrefix, fontFamily, model, cheapModel, imageModel,
    imageLibraryEnabled, imageLibraryMaxReuse, profileSlug, kenBurns, grain, footageConfig, format,
  } = req.body ?? {};

  // "footage" needs no LLM call at all — see build-footage-plan.mjs's own doc comment
  // (the whole template is "don't care about video content", nothing for a model to
  // write per scene) — so it doesn't go through queues.dashscope, and doesn't need
  // `signal` (nothing to cancel, this returns near-instantly). Unlike "motion"/"sub"
  // (whose video-plan LLM infers `format` itself from DESIGN.md's own content, which
  // was generated with the project's platform baked in), this deterministic path has
  // no LLM to read that context — the caller must pass `format` directly (Pipeline.jsx
  // already tracks it as the same `platform` prop used for the content-planner call).
  if (template === "footage") {
    runInBackground(req.projectDir, "video-plan", (onEvent) =>
      buildFootagePlan({ projectDir: req.projectDir, format: format || "9:16", footageConfig, onEvent })
    );
    return res.status(202).json({ step: "video-plan", status: "running" });
  }

  runInBackground(req.projectDir, "video-plan", (onEvent, signal) =>
    queues.dashscope.run(() =>
      runVideoPlanner({
        projectDir: req.projectDir,
        visualStyle,
        template,
        subStyle,
        imageStylePrefix,
        fontFamily,
        model,
        cheapModel,
        imageModel,
        imageLibraryEnabled,
        imageLibraryMaxReuse,
        profileSlug,
        kenBurns,
        grain,
        onEvent,
        signal,
      })
    )
  );
  res.status(202).json({ step: "video-plan", status: "running" });
});

// Patches visual-effect flags (kenBurns, grain, ...) directly into an already-written
// video-plan.json — no LLM call, for videos where video-plan.json/scenes/render
// already exist and the user only wants to toggle an effect on/off before
// re-generating scene compositions. Re-running the full /video-plan route instead
// would burn an LLM call and risks the model re-writing visual_brief/image_tags
// differently on retry — this route changes nothing the LLM authored, only these
// code-owned fields (same fields written by runVideoPlanner itself). Only patches
// fields actually present in the request body, so callers can flip just one effect
// without knowing/resending the others.
const EFFECT_FIELDS = ["kenBurns", "grain"];
router.post("/projects/:id/video-plan/effects", withProjectDir, (req, res) => {
  const videoPlanFile = join(req.projectDir, "video-plan.json");
  if (!existsSync(videoPlanFile)) return res.status(400).json({ error: "video-plan.json not found — run /video-plan first" });
  const plan = JSON.parse(readFileSync(videoPlanFile, "utf-8"));
  if (plan.template !== "sub") return res.status(400).json({ error: `Effects chỉ áp dụng cho template "sub" (project này là "${plan.template}")` });
  for (const field of EFFECT_FIELDS) {
    if (req.body?.[field] !== undefined) plan[field] = Boolean(req.body[field]);
  }
  writeFileSync(videoPlanFile, JSON.stringify(plan, null, 2));
  res.json(Object.fromEntries(EFFECT_FIELDS.map((f) => [f, plan[f] ?? false])));
});

router.post("/projects/:id/scenes/:sceneId/generate", withProjectDir, (req, res) => {
  const { sceneId } = req.params;
  const videoPlanFile = join(req.projectDir, "video-plan.json");
  if (!existsSync(videoPlanFile)) return res.status(400).json({ error: "video-plan.json not found — run /video-plan first" });

  const videoPlan = JSON.parse(readFileSync(videoPlanFile, "utf-8"));
  const scene = videoPlan.scenes?.find((s) => s.sceneId === sceneId);
  if (!scene) return res.status(404).json({ error: `Scene "${sceneId}" not found in video-plan.json` });

  // `template` is written by video-planner.mjs itself (code, not the model) — see
  // its doc comment for why trusting the LLM to echo this correctly was rejected.
  if (videoPlan.template === "sub") {
    const timingFile = join(req.projectDir, "scenes-with-timing.json");
    if (!existsSync(timingFile)) return res.status(400).json({ error: "scenes-with-timing.json not found — run /audio first" });
    const sceneTiming = JSON.parse(readFileSync(timingFile, "utf-8")).scenes?.find((s) => s.sceneId === sceneId);
    if (!sceneTiming) return res.status(404).json({ error: `Scene "${sceneId}" not found in scenes-with-timing.json` });

    runInBackground(req.projectDir, `scene:${sceneId}`, (onEvent, signal) =>
      queues.dashscope.run(() =>
        runSubSceneWriter({
          projectDir: req.projectDir,
          scene,
          sceneTiming,
          format: videoPlan.format,
          subStyle: videoPlan.subStyle,
          fontFamily: videoPlan.fontFamily,
          imageModel: videoPlan.imageModel,
          imageLibrary: videoPlan.imageLibrary,
          kenBurns: videoPlan.kenBurns,
          grain: videoPlan.grain,
          onEvent,
          signal,
        })
      )
    );
    return res.status(202).json({ step: `scene:${sceneId}`, status: "running" });
  }

  if (videoPlan.template === "footage") {
    const timingFile = join(req.projectDir, "scenes-with-timing.json");
    if (!existsSync(timingFile)) return res.status(400).json({ error: "scenes-with-timing.json not found — run /audio first" });
    const sceneTiming = JSON.parse(readFileSync(timingFile, "utf-8")).scenes?.find((s) => s.sceneId === sceneId);
    if (!sceneTiming) return res.status(404).json({ error: `Scene "${sceneId}" not found in scenes-with-timing.json` });

    // queues.ffmpeg, not queues.dashscope — no DashScope call involved, just local
    // ffmpeg processes; still queued to cap parallel ffmpeg spawns from "Generate tất cả".
    runInBackground(req.projectDir, `scene:${sceneId}`, (onEvent, signal) =>
      queues.ffmpeg.run(() =>
        runFootageWriter({
          projectDir: req.projectDir,
          scene,
          sceneTiming,
          format: videoPlan.format,
          footageConfig: videoPlan.footageConfig,
          onEvent,
          signal,
        })
      )
    );
    return res.status(202).json({ step: `scene:${sceneId}`, status: "running" });
  }

  const designFile = join(req.projectDir, "DESIGN.md");
  if (!existsSync(designFile)) return res.status(400).json({ error: "DESIGN.md not found in project" });
  const design = readFileSync(designFile, "utf-8");

  runInBackground(req.projectDir, `scene:${sceneId}`, (onEvent, signal) =>
    queues.dashscope.run(() =>
      runSceneWriter({
        projectDir: req.projectDir,
        scene,
        design,
        format: videoPlan.format,
        model: videoPlan.cheapModel,
        imageModel: videoPlan.imageModel,
        imageLibrary: videoPlan.imageLibrary,
        onEvent,
        signal,
      })
    )
  );
  res.status(202).json({ step: `scene:${sceneId}`, status: "running" });
});

// Automates CLAUDE.md step 6 ("Viết root index.html") — the one pipeline step that
// was never automated by the routes above. Without it, `index.html` stays the blank
// `hyperframes init` scaffold and /render silently "succeeds" while producing an
// empty/black video, because nothing in the root timeline references the generated
// scene sub-compositions — confirmed live via the UI. Only wires scenes whose
// `scene:<id>` step is actually "done" in job-status, so a scene that failed
// scene-writer (its .html may still be on disk from a failed attempt) never gets
// pulled into the final video.
router.post("/projects/:id/root", withProjectDir, (req, res) => {
  const scenesWithTimingFile = join(req.projectDir, "scenes-with-timing.json");
  if (!existsSync(scenesWithTimingFile)) {
    return res.status(400).json({ error: "scenes-with-timing.json not found — run /audio first" });
  }
  const designFile = join(req.projectDir, "DESIGN.md");
  if (!existsSync(designFile)) return res.status(400).json({ error: "DESIGN.md not found in project" });
  const videoPlanFile = join(req.projectDir, "video-plan.json");
  if (!existsSync(videoPlanFile)) return res.status(400).json({ error: "video-plan.json not found — run /video-plan first" });

  const scenesWithTiming = JSON.parse(readFileSync(scenesWithTimingFile, "utf-8"));
  const design = readFileSync(designFile, "utf-8");
  const videoPlan = JSON.parse(readFileSync(videoPlanFile, "utf-8"));

  const { steps } = readJobStatus(req.projectDir);
  const doneSceneIds = (scenesWithTiming.scenes ?? [])
    .map((s) => s.sceneId)
    .filter((id) => steps[`scene:${id}`]?.status === "done");

  if (!doneSceneIds.length) {
    return res.status(400).json({ error: "No scenes have finished generating yet — generate at least one scene first" });
  }

  runInBackground(req.projectDir, "root", (onEvent, signal) =>
    queues.dashscope.run(() =>
      runRootComposer({
        projectDir: req.projectDir,
        design,
        scenesWithTiming,
        doneSceneIds,
        format: videoPlan.format,
        template: videoPlan.template,
        model: videoPlan.cheapModel,
        onEvent,
        signal,
      })
    )
  );
  res.status(202).json({ step: "root", status: "running", sceneIds: doneSceneIds });
});

router.post("/projects/:id/render", withProjectDir, (req, res) => {
  runInBackground(req.projectDir, "render", (onEvent, signal) => render(req.projectDir, { signal }));
  res.status(202).json({ step: "render", status: "running" });
});

// Instagram Reels caption + hashtags, ready to copy-paste — see agents/caption-writer.mjs.
// No hard data dependency on render (only needs master_content.md, already written by
// the "plan" step), but placed after render in the UI as the final "ready to publish"
// companion to the finished MP4.
router.post("/projects/:id/caption", withProjectDir, (req, res) => {
  const masterContentFile = join(req.projectDir, "master_content.md");
  if (!existsSync(masterContentFile)) return res.status(400).json({ error: "master_content.md not found — chạy bước Content plan trước" });
  const designFile = join(req.projectDir, "DESIGN.md");
  if (!existsSync(designFile)) return res.status(400).json({ error: "DESIGN.md not found in project" });

  const masterContent = readFileSync(masterContentFile, "utf-8");
  const design = readFileSync(designFile, "utf-8");

  runInBackground(req.projectDir, "caption", (onEvent, signal) =>
    queues.dashscope.run(() => runCaptionWriter({ projectDir: req.projectDir, masterContent, design, onEvent, signal }))
  );
  res.status(202).json({ step: "caption", status: "running" });
});

router.get("/projects/:id/renders", withProjectDir, (req, res) => {
  const rendersDir = join(req.projectDir, "renders");
  if (!existsSync(rendersDir)) return res.json({ renders: [] });
  const renders = readdirSync(rendersDir)
    .filter((f) => f.endsWith(".mp4") && !f.startsWith("._"))
    .map((name) => ({ name, mtime: statSync(join(rendersDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ renders });
});

// `res.sendFile` (not a raw readStream) specifically because it goes through
// Express's `send` middleware, which handles HTTP Range requests — required for
// scrubbing/seeking in an HTML5 <video> player, not just play-from-start.
router.get("/projects/:id/renders/:name", withProjectDir, (req, res) => {
  const { name } = req.params;
  const rendersDir = join(req.projectDir, "renders");
  const file = resolve(rendersDir, name);
  const rel = relative(rendersDir, file);
  const escapes = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (escapes || !name.endsWith(".mp4")) return res.status(400).json({ error: "Invalid render filename" });
  if (!existsSync(file)) return res.status(404).json({ error: `${name} not found` });
  res.sendFile(file);
});

// Serves a scene's AI-generated background image (assets/images/scene_XX.png) so the
// UI can preview it directly instead of only seeing it baked into a rendered scene.
router.get("/projects/:id/images/:name", withProjectDir, (req, res) => {
  const { name } = req.params;
  const imagesDir = join(req.projectDir, "assets", "images");
  const file = resolve(imagesDir, name);
  const rel = relative(imagesDir, file);
  const escapes = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (escapes || !name.endsWith(".png")) return res.status(400).json({ error: "Invalid image filename" });
  if (!existsSync(file)) return res.status(404).json({ error: `${name} not found` });
  res.sendFile(file);
});

// Serves a scene's voiceover mp3 (assets/audio/scene_XX_vo.mp3) so the UI can offer a
// "listen before generating this scene" player — catches TTS mispronunciation/rate
// issues at the cheap step (audio) instead of discovering them only in a rendered
// video after also paying for image/scene generation.
router.get("/projects/:id/audio/:name", withProjectDir, (req, res) => {
  const { name } = req.params;
  const audioDir = join(req.projectDir, "assets", "audio");
  const file = resolve(audioDir, name);
  const rel = relative(audioDir, file);
  const escapes = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (escapes || !name.endsWith(".mp3")) return res.status(400).json({ error: "Invalid audio filename" });
  if (!existsSync(file)) return res.status(404).json({ error: `${name} not found` });
  res.sendFile(file);
});

// Serves a scene's ffmpeg-assembled footage clip (assets/footage/scene_XX.mp4) for
// the "footage" template's SceneGrid preview — `res.sendFile` (not a raw stream) for
// the same Range-request reason as /renders/:name above, since this is previewed in
// an HTML5 <video> element too.
router.get("/projects/:id/footage/:name", withProjectDir, (req, res) => {
  const { name } = req.params;
  const footageDir = join(req.projectDir, "assets", "footage");
  const file = resolve(footageDir, name);
  const rel = relative(footageDir, file);
  const escapes = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (escapes || !name.endsWith(".mp4")) return res.status(400).json({ error: "Invalid footage filename" });
  if (!existsSync(file)) return res.status(404).json({ error: `${name} not found` });
  res.sendFile(file);
});

// Global (not project-scoped) — reports the size of the shared stock-footage pool so
// the UI can confirm it's pointed at a populated folder before the user tries to
// generate a "footage" template scene. See lib/footage-library.mjs's own doc comment
// for why this is one shared pool, not scoped per-project/profile.
router.get("/footage-library", async (req, res) => {
  try {
    const files = await scanFootageLibrary();
    res.json({ count: files.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ensures an on-demand `hyperframes preview` dev server is running for this project
// (started lazily, one per project, auto-stopped after PREVIEW_IDLE_TIMEOUT_MS of no
// requests — see jobs/preview.mjs) and hands back its own URL directly, rather than
// reverse-proxying it under this path.
//
// A path-prefixed proxy (`/projects/:id/preview/* -> 127.0.0.1:<port>/*`) was tried
// first and confirmed broken live: HyperFrames Studio's built HTML references its
// JS/CSS bundle with root-absolute paths (`/assets/index-*.js`), so the browser
// requests those straight from this server's own origin (`http://localhost:3001/assets/...`),
// never through the proxy prefix at all — 404s with an HTML error body served as
// "text/javascript", which browsers refuse to execute (MIME-check errors). Properly
// proxying an app that assumes it's mounted at `/` requires rewriting HTML/asset URLs
// in-flight, which is out of scope here — returning the dev server's own
// `http://localhost:<port>/` for the frontend's <iframe src> to use directly sidesteps
// the problem entirely (it's on http://localhost already, so no CORS or mixed-content
// issue for an iframe).
router.get("/projects/:id/preview-url", withProjectDir, async (req, res) => {
  let port;
  try {
    port = await ensurePreview(req.projectDir);
  } catch (err) {
    return res.status(502).json({ error: `Preview failed to start: ${err.message}` });
  }
  touchPreview(req.projectDir);
  res.json({ url: `http://localhost:${port}/` });
});

router.get("/projects/:id/events", withProjectDir, (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const emitter = getEmitter(req.projectDir);
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  send({ type: "snapshot", status: readJobStatus(req.projectDir) });
  emitter.on("event", send);

  req.on("close", () => emitter.off("event", send));
});
