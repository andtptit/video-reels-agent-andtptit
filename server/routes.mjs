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
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, relative, isAbsolute, sep } from "path";
import { resolveProjectDir, toProjectId, listProjects, InvalidProjectIdError } from "./lib/project-id.mjs";
import { createProject } from "./pipeline/new-project.mjs";
import { runGenerateAudio } from "./pipeline/generate-audio.mjs";
import { runContentPlanner } from "./agents/content-planner.mjs";
import { runVideoPlanner } from "./agents/video-planner.mjs";
import { runSceneWriter } from "./agents/scene-writer.mjs";
import { runRootComposer } from "./agents/root-composer.mjs";
import { render } from "./tools/hyperframes-cli.mjs";
import { readJobStatus, runStep, getEmitter } from "./jobs/job-status.mjs";
import { queues } from "./jobs/queue.mjs";
import { ensurePreview, touchPreview, startIdleSweep } from "./jobs/preview.mjs";

startIdleSweep();

// Checkpoint files the frontend is allowed to read back for review (step 2/4 of the
// pipeline in CLAUDE.md) — an explicit allowlist, not "any file", since :id/:name
// would otherwise let a client read arbitrary project files (assets, .env-adjacent
// config) through this route.
const READABLE_FILES = {
  "master_content.md": "text/markdown",
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

router.get("/projects/:id/files/:name", withProjectDir, (req, res) => {
  const { name } = req.params;
  const contentType = READABLE_FILES[name];
  if (!contentType) return res.status(400).json({ error: `Not readable: ${name}` });
  const file = join(req.projectDir, name);
  if (!existsSync(file)) return res.status(404).json({ error: `${name} not found` });
  res.type(contentType).send(readFileSync(file, "utf-8"));
});

router.post("/projects/:id/plan", withProjectDir, (req, res) => {
  const { idea, audience, platform, targetDuration } = req.body ?? {};
  if (!idea) return res.status(400).json({ error: "idea is required" });
  if (!audience) return res.status(400).json({ error: "audience is required" });

  runInBackground(req.projectDir, "plan", (onEvent) =>
    queues.dashscope.run(() =>
      runContentPlanner({ idea, projectDir: req.projectDir, audience, platform, targetDuration, onEvent })
    )
  );
  res.status(202).json({ step: "plan", status: "running" });
});

router.post("/projects/:id/audio", withProjectDir, (req, res) => {
  const { ttsProvider } = req.body ?? {};
  runInBackground(req.projectDir, "audio", () =>
    queues.tts.run(() => runGenerateAudio(req.projectDir, { ttsProvider }))
  );
  res.status(202).json({ step: "audio", status: "running" });
});

router.post("/projects/:id/video-plan", withProjectDir, (req, res) => {
  runInBackground(req.projectDir, "video-plan", (onEvent) =>
    queues.dashscope.run(() => runVideoPlanner({ projectDir: req.projectDir, onEvent }))
  );
  res.status(202).json({ step: "video-plan", status: "running" });
});

router.post("/projects/:id/scenes/:sceneId/generate", withProjectDir, (req, res) => {
  const { sceneId } = req.params;
  const videoPlanFile = join(req.projectDir, "video-plan.json");
  if (!existsSync(videoPlanFile)) return res.status(400).json({ error: "video-plan.json not found — run /video-plan first" });

  const videoPlan = JSON.parse(readFileSync(videoPlanFile, "utf-8"));
  const scene = videoPlan.scenes?.find((s) => s.sceneId === sceneId);
  if (!scene) return res.status(404).json({ error: `Scene "${sceneId}" not found in video-plan.json` });

  const designFile = join(req.projectDir, "DESIGN.md");
  if (!existsSync(designFile)) return res.status(400).json({ error: "DESIGN.md not found in project" });
  const design = readFileSync(designFile, "utf-8");

  runInBackground(req.projectDir, `scene:${sceneId}`, (onEvent) =>
    queues.dashscope.run(() => runSceneWriter({ projectDir: req.projectDir, scene, design, format: videoPlan.format, onEvent }))
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

  const scenesWithTiming = JSON.parse(readFileSync(scenesWithTimingFile, "utf-8"));
  const design = readFileSync(designFile, "utf-8");

  const { steps } = readJobStatus(req.projectDir);
  const doneSceneIds = (scenesWithTiming.scenes ?? [])
    .map((s) => s.sceneId)
    .filter((id) => steps[`scene:${id}`]?.status === "done");

  if (!doneSceneIds.length) {
    return res.status(400).json({ error: "No scenes have finished generating yet — generate at least one scene first" });
  }

  runInBackground(req.projectDir, "root", (onEvent) =>
    queues.dashscope.run(() => runRootComposer({ projectDir: req.projectDir, design, scenesWithTiming, doneSceneIds, onEvent }))
  );
  res.status(202).json({ step: "root", status: "running", sceneIds: doneSceneIds });
});

router.post("/projects/:id/render", withProjectDir, (req, res) => {
  runInBackground(req.projectDir, "render", () => render(req.projectDir));
  res.status(202).json({ step: "render", status: "running" });
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
