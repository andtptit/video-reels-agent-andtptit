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
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, rmdirSync, mkdirSync } from "fs";
import { join, resolve, relative, isAbsolute, sep, dirname, extname } from "path";
import { execFile } from "child_process";
import multer from "multer";
import { resolveProjectDir, toProjectId, listProjects, InvalidProjectIdError } from "./lib/project-id.mjs";
import { exportProject, exportAllReady, EXPORT_DIR } from "./lib/export-ready.mjs";
import { DEFAULT_MODEL, CHEAP_MODEL } from "./agents/run-agent.mjs";
import { createProject } from "./pipeline/new-project.mjs";
import { runGenerateAudio } from "./pipeline/generate-audio.mjs";
import { runAudioImport } from "./pipeline/audio-import.mjs";
import { createRemixProject } from "./pipeline/remix-project.mjs";
import { runContentPlanner } from "./agents/content-planner.mjs";
import { runInvestigationContentPlanner } from "./agents/investigation-content-planner.mjs";
import { runScriptSceneCutter } from "./agents/script-scene-cutter.mjs";
import { runPlaybookTrainer } from "./agents/playbook-trainer.mjs";
import * as hyperframesWhisper from "./providers/transcription/hyperframes-whisper.mjs";
import { runVideoPlanner } from "./agents/video-planner.mjs";
import { runRemixScenes } from "./agents/remix-scenes.mjs";
import { runSceneWriter } from "./agents/scene-writer.mjs";
import { runSubSceneWriter } from "./agents/sub-scene-writer.mjs";
import { runRootComposer } from "./agents/root-composer.mjs";
import { runCaptionWriter } from "./agents/caption-writer.mjs";
import { buildFootagePlan } from "./pipeline/build-footage-plan.mjs";
import { runFootageWriter } from "./agents/footage-scene-writer.mjs";
import { scanFootageLibrary, resolveLibraryDir } from "./lib/footage-library.mjs";
import { searchAndSaveVideos } from "./providers/video/pexels-video.mjs";
import { chatCompletion } from "./providers/llm/dashscope.mjs";
import { render } from "./tools/hyperframes-cli.mjs";
import { readJobStatus, runStep, getEmitter, emitProgress, setProjectProfile } from "./jobs/job-status.mjs";
import { queues } from "./jobs/queue.mjs";
import { ensurePreview, touchPreview, startIdleSweep } from "./jobs/preview.mjs";
import { listProfiles, saveProfile, deleteProfile } from "./lib/profiles.mjs";
import {
  getPageAccessToken,
  hasPageAccessToken,
  savePageAccessToken,
  deletePageAccessToken,
} from "./lib/facebook-secrets.mjs";
import { testConnection as testFacebookConnection, publishReelToFacebook } from "./providers/social/facebook-reels.mjs";
import { probeDuration } from "./tools/ffmpeg-cli.mjs";
import { createBatchDir, resolveBatchDir, InvalidBatchIdError } from "./lib/batch-id.mjs";
import { readIdeaHistory, appendIdeaHistory } from "./lib/idea-history.mjs";
import { runIdeaGenerator } from "./agents/idea-generator.mjs";
import { generateImage } from "./providers/image/dashscope-image.mjs";
import { cancelStep, CancelledError } from "./jobs/cancel-registry.mjs";
// "Đọc Caption" tab — fully separate video format (no voiceover, blurred footage
// card + static hook/CTA text), own profile store. See plan.md.
import { listHookProfiles, saveHookProfile, deleteHookProfile } from "./lib/hook-profiles.mjs";
import { runHookContentWriter } from "./agents/hook-content-writer.mjs";
import { buildHookVideoPlan } from "./pipeline/build-hook-video-plan.mjs";
import { runHookSceneWriter } from "./agents/hook-scene-writer.mjs";
import { buildHookRoot } from "./pipeline/build-hook-root.mjs";

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

// "Tạo từ audio có sẵn" (audio-import.mjs) upload — the only route in this codebase
// that accepts a file body, so this is genuinely new infrastructure (no existing
// multer/formidable/busboy anywhere else). `diskStorage` (not `memoryStorage`):
// uploaded audio can be tens of MB, streaming straight to disk avoids buffering the
// whole file in process memory — matches this repo's disk-first philosophy (no DB,
// everything is files). Written directly to its final resting place
// (assets/source/source.<ext> inside the project) so audio-import.mjs never needs to
// copy it again.
const audioImportUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const dir = join(resolveProjectDir(req.params.id), "assets", "source");
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => cb(null, `source${extname(file.originalname) || ".mp3"}`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB — generous ceiling for a spoken-word upload, not a hard product requirement
});

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

// Quick "test kịch bản" tool — lets a user iterate on a profile's contentPlaybook
// (see lib/profiles.mjs) BEFORE committing to a real project (found live, user
// request: "cần sinh kịch bản thuần text cho tôi xem trước, để tôi còn nâng cấp và
// chỉnh sửa dần các câu lệnh"). Reuses the SAME scratch-dir infra as the "Hàng loạt"
// batch feature (server/batches/{id}/ — never a real hyperframes project, invisible
// to listProjects()) purely as a throwaway write target for the agent's own
// write_file tool calls; nothing here is meant to be resumed/approved like a real
// batch is. `kind` selects which agent writes the script — same 3 script-writing
// agents used elsewhere in the app (content-planner for Pipeline/Batch, investigation
// for "Bảng điều tra", hook for "Đọc Caption") so every tab with a script-generation
// step gets the same preview capability.
router.post("/test-content-plan", (req, res) => {
  const {
    kind = "content-planner",
    idea,
    audience,
    platform,
    targetDuration,
    profileSlug,
    // Direct override takes priority over the profileSlug lookup below — lets
    // ProfileManager.jsx's own "Sinh kịch bản test" preview the CURRENTLY-EDITED
    // (not-yet-saved) contentPlaybook textarea instead of forcing a save first.
    contentPlaybook: contentPlaybookOverride,
    model,
    nicheDescription,
    ctaText,
  } = req.body ?? {};
  if (!idea?.trim()) return res.status(400).json({ error: "idea is required" });

  const { id, dir } = createBatchDir();
  const contentPlaybook = contentPlaybookOverride ?? (profileSlug ? listProfiles().find((p) => p.slug === profileSlug)?.contentPlaybook : undefined);

  const runners = {
    "content-planner": (onEvent, signal) =>
      runContentPlanner({ idea, projectDir: dir, audience, platform, targetDuration, contentPlaybook, model, onEvent, signal }),
    investigation: (onEvent, signal) =>
      runInvestigationContentPlanner({ idea, projectDir: dir, audience, platform, targetDuration, contentPlaybook, model, onEvent, signal }),
    hook: (onEvent, signal) =>
      runHookContentWriter({ idea, projectDir: dir, nicheDescription, ctaText, model, onEvent, signal }),
  };
  const runner = runners[kind];
  if (!runner) return res.status(400).json({ error: `kind không hợp lệ: ${kind}` });

  runInBackground(dir, "test-plan", (onEvent, signal) => queues.dashscope.run(() => runner(onEvent, signal)));
  res.status(202).json({ testId: id, step: "test-plan", status: "running" });
});

// Reads back whatever the agent wrote in /test-content-plan above — master_content.md
// for content-planner/investigation, hook-plan.json for hook (no separate free-text
// file for that one — see hook-content-writer.mjs's own doc comment on why
// caption.md is built from it deterministically rather than written directly).
router.get("/test-content-plan/:id/result", (req, res) => {
  let dir;
  try {
    dir = resolveBatchDir(req.params.id);
  } catch (err) {
    if (err instanceof InvalidBatchIdError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (!existsSync(dir)) return res.status(404).json({ error: "Not found" });
  const mcPath = join(dir, "master_content.md");
  const hookPath = join(dir, "hook-plan.json");
  const text = existsSync(mcPath)
    ? readFileSync(mcPath, "utf-8")
    : existsSync(hookPath)
      ? JSON.stringify(JSON.parse(readFileSync(hookPath, "utf-8")), null, 2)
      : null;
  res.json({ status: readJobStatus(dir), text });
});

// Cap on how many sample scripts go into ONE runPlaybookTrainer call — found live
// (user request): raising the UI limit to 10 samples straight into a single LLM
// call risks an overly long prompt (10 full video transcripts combined). Instead,
// chunk into groups of this size and call the trainer SEQUENTIALLY, feeding each
// chunk's result forward as the next chunk's `existingPlaybook` — this is exactly
// the "cộng dồn, không ghi đè" behavior playbook-trainer.mjs already implements for
// re-training an existing profile, just looped within one training run instead of
// across separate user-initiated trainings.
const TRAIN_CHUNK_SIZE = 5;

async function trainPlaybookInChunks({ batchDir, description, sampleScripts, existingPlaybook, model, onEvent, signal }) {
  let currentPlaybook = existingPlaybook;
  let result;
  for (let i = 0; i < sampleScripts.length; i += TRAIN_CHUNK_SIZE) {
    const chunk = sampleScripts.slice(i, i + TRAIN_CHUNK_SIZE);
    result = await runPlaybookTrainer({ batchDir, description, sampleScripts: chunk, existingPlaybook: currentPlaybook, model, onEvent, signal });
    currentPlaybook = result.playbook;
  }
  return result;
}

// "Training" cho Content playbook — ProfileManager.jsx. Cùng shape scratch-dir +
// runInBackground + poll-result như /test-content-plan ở trên (không phải project
// thật, không cần lưu profile trước). Xem playbook-trainer.mjs's doc comment cho lý
// do trích xuất pattern trừu tượng thay vì chép nguyên văn mẫu.
router.post("/train-playbook", (req, res) => {
  // `sampleScripts` (array, up to 10) is the real param; `sampleScript` (singular)
  // still accepted for back-compat with any in-flight client build.
  const { description, sampleScript, sampleScripts, existingPlaybook, model } = req.body ?? {};
  const samples = (Array.isArray(sampleScripts) ? sampleScripts : sampleScript ? [sampleScript] : [])
    .filter((s) => typeof s === "string" && s.trim())
    .slice(0, 10);
  if (!samples.length) return res.status(400).json({ error: "Cần ít nhất 1 kịch bản mẫu" });

  const { id, dir } = createBatchDir();
  runInBackground(dir, "train-playbook", (onEvent, signal) =>
    queues.dashscope.run(() => trainPlaybookInChunks({ batchDir: dir, description, sampleScripts: samples, existingPlaybook, model, onEvent, signal }))
  );
  res.status(202).json({ trainId: id, step: "train-playbook", status: "running" });
});

// Training từ video đối thủ (thay vì paste text) — up to 10 file, mỗi file tự
// transcribe qua Whisper (nhận thẳng video, tự tách audio bên trong — xác nhận qua
// tài liệu hyperframes-media skill: `npx hyperframes transcribe video.mp4` là cú
// pháp hợp lệ, không cần code tự tách audio bằng ffmpeg trước). Batch dir phải được
// tạo TRƯỚC khi multer chạy (nó cần biết destination ngay khi nhận từng file) — tạo
// ở 1 middleware nhỏ trước `trainVideoUpload`, không phải trong route handler.
const trainVideoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const dir = join(req.trainBatchDir, "uploads");
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname) || ".mp4"}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024, files: 10 }, // 500MB/file — a few minutes of 1080p Reels video
});

router.post(
  "/train-playbook-videos",
  (req, res, next) => {
    const { id, dir } = createBatchDir();
    req.trainBatchId = id;
    req.trainBatchDir = dir;
    next();
  },
  trainVideoUpload.array("videos", 10),
  (req, res) => {
    const { description, existingPlaybook, model, language } = req.body ?? {};
    const files = req.files ?? [];
    if (!files.length) return res.status(400).json({ error: "at least 1 video file is required" });

    const dir = req.trainBatchDir;
    const id = req.trainBatchId;

    runInBackground(dir, "train-playbook", async (onEvent, signal) => {
      const sampleScripts = [];
      for (const file of files) {
        onEvent({ type: "transcribe-start", file: file.originalname });
        const { fullText } = await hyperframesWhisper.transcribe({ srcPath: file.path, language: language || "vi", signal });
        sampleScripts.push(fullText);
        onEvent({ type: "transcribe-done", file: file.originalname, chars: fullText.length });
      }
      return queues.dashscope.run(() => trainPlaybookInChunks({ batchDir: dir, description, sampleScripts, existingPlaybook, model, onEvent, signal }));
    });

    res.status(202).json({ trainId: id, step: "train-playbook", status: "running", videoCount: files.length });
  }
);

router.get("/train-playbook/:id/result", (req, res) => {
  let dir;
  try {
    dir = resolveBatchDir(req.params.id);
  } catch (err) {
    if (err instanceof InvalidBatchIdError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (!existsSync(dir)) return res.status(404).json({ error: "Not found" });
  const playbookPath = join(dir, "playbook.json");
  const playbook = existsSync(playbookPath) ? JSON.parse(readFileSync(playbookPath, "utf-8")).playbook : null;
  res.json({ status: readJobStatus(dir), playbook });
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

// Facebook Page Access Token — deliberately NOT part of PUT /profiles/:name's payload,
// see lib/facebook-secrets.mjs's own doc comment on why (real credential, kept out of
// the committed profile JSON). GET only ever exposes whether a token is saved, never
// its value.
router.get("/profiles/:slug/facebook-token", (req, res) => {
  res.json({ hasToken: hasPageAccessToken(req.params.slug) });
});

router.put("/profiles/:slug/facebook-token", (req, res) => {
  try {
    savePageAccessToken(req.params.slug, req.body?.pageAccessToken);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/profiles/:slug/facebook-token", (req, res) => {
  deletePageAccessToken(req.params.slug);
  res.status(204).end();
});

// "Kiểm tra kết nối" button in Hồ sơ kênh — confirms the Page ID + saved token are
// valid and match, without touching video_reels at all.
router.post("/profiles/:slug/facebook-test", async (req, res) => {
  const profile = listProfiles().find((p) => p.slug === req.params.slug);
  if (!profile?.facebookPageId) return res.status(400).json({ error: "Profile chưa có Facebook Page ID — điền ở Hồ sơ kênh trước." });
  const pageAccessToken = getPageAccessToken(req.params.slug);
  if (!pageAccessToken) return res.status(400).json({ error: "Profile chưa lưu Facebook Page Access Token." });
  try {
    const { pageName } = await testFacebookConnection({ pageId: profile.facebookPageId, pageAccessToken });
    res.json({ ok: true, pageName });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// "Đọc Caption" tab's own niche profiles — see lib/hook-profiles.mjs doc comment for
// why this is a fully separate store from /profiles above, not a variant of it.
router.get("/hook-profiles", (req, res) => {
  res.json({ profiles: listHookProfiles() });
});

router.put("/hook-profiles/:name", (req, res) => {
  try {
    res.json(saveHookProfile(req.params.name, req.body ?? {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/hook-profiles/:slug", (req, res) => {
  deleteHookProfile(req.params.slug);
  res.status(204).end();
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
  const { channelTheme, audience, count, profileSlug, avoidExtra } = req.body ?? {};
  if (!channelTheme?.trim()) return res.status(400).json({ error: "channelTheme is required" });
  if (!audience?.trim()) return res.status(400).json({ error: "audience is required" });
  if (!profileSlug) return res.status(400).json({ error: "profileSlug is required — chọn 1 profile kênh trước" });

  const n = Math.min(Math.max(Number(count) || 10, 1), 30);
  const { id: batchId, dir: batchDir } = createBatchDir();
  // `avoidExtra` — subTopics from the CALLER'S own previous, still-unapproved batch
  // (see Batch.jsx's generateIdeas) — idea-history.mjs only ever records ideas AFTER
  // they're approved into a real project, so a batch the user never got to approve
  // would otherwise be invisible to this dedup check entirely, letting the new lô
  // regenerate near-identical topics to the one it's about to orphan.
  const avoidList = [
    ...readIdeaHistory(profileSlug, { limit: 30 }).map((h) => `${h.subTopic} — ${h.idea}`),
    ...(Array.isArray(avoidExtra) ? avoidExtra.filter((s) => typeof s === "string" && s.trim()) : []),
  ];
  const profileForBatch = listProfiles().find((p) => p.slug === profileSlug);
  const contentPlaybook = profileForBatch?.contentPlaybook;
  // See lib/profiles.mjs's `ideaTones` doc comment — only passed when the profile set
  // a non-empty override, otherwise idea-generator.mjs falls back to its own default.
  const tones = Array.isArray(profileForBatch?.ideaTones) && profileForBatch.ideaTones.length ? profileForBatch.ideaTones : undefined;

  writeFileSync(
    join(batchDir, "ideas.json"),
    JSON.stringify({ channelTheme, audience, requestedCount: n, profileSlug, avoidListUsed: avoidList, createdAt: new Date().toISOString(), ideas: [] }, null, 2)
  );

  runInBackground(batchDir, "ideate", (onEvent, signal) =>
    queues.dashscope.run(() => runIdeaGenerator({ batchDir, channelTheme, audience, count: n, avoidList, contentPlaybook, ...(tones ? { tones } : {}), onEvent, signal }))
  );

  res.status(202).json({ batchId, step: "ideate", status: "running" });
});

// Bulk "Kịch bản có sẵn" — same batch dir/ideas.json shape as POST /batches above
// (Batch.jsx's approve/run loop is agnostic to how an idea got its content), but no
// LLM ideate call at all: scripts are already fully written and split client-side on
// "---", so this writes ideas.json directly and returns immediately (no background
// step to poll for, unlike /batches' async "ideate"). Each idea gets `scriptText`
// instead of the AI fields (hookStyle/tone/subTopic) — runApproval (Batch.jsx) reads
// that field to call POST /projects/:id/script-plan instead of /plan.
router.post("/batches/from-scripts", (req, res) => {
  const { scripts, profileSlug } = req.body ?? {};
  if (!Array.isArray(scripts) || !scripts.length) return res.status(400).json({ error: "scripts is required (mảng, ít nhất 1 kịch bản)" });
  if (!profileSlug) return res.status(400).json({ error: "profileSlug is required — chọn 1 profile kênh trước" });

  const { id: batchId, dir: batchDir } = createBatchDir();
  const ideas = scripts.map((s, i) => ({
    ideaId: `idea-${String(i + 1).padStart(2, "0")}`,
    idea: String(s.title ?? "").trim() || `Kịch bản ${i + 1}`,
    scriptText: String(s.scriptText ?? "").trim(),
    kept: true,
    status: "pending",
  }));

  writeFileSync(join(batchDir, "ideas.json"), JSON.stringify({ profileSlug, createdAt: new Date().toISOString(), ideas }, null, 2));
  res.status(201).json({ batchId });
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
  const { idea, audience, platform, targetDuration, model, profileSlug } = req.body ?? {};
  if (!idea) return res.status(400).json({ error: "idea is required" });
  if (!audience) return res.status(400).json({ error: "audience is required" });

  // Server-resolved (not client-supplied text) so the playbook actually used always
  // matches whatever is currently saved on the profile, same trust boundary as every
  // other profile-owned field (template/subStyle/etc. read server-side elsewhere).
  const contentPlaybook = profileSlug ? listProfiles().find((p) => p.slug === profileSlug)?.contentPlaybook : undefined;
  setProjectProfile(req.projectDir, profileSlug);

  runInBackground(req.projectDir, "plan", (onEvent, signal) =>
    queues.dashscope.run(() =>
      runContentPlanner({ idea, projectDir: req.projectDir, audience, platform, targetDuration, contentPlaybook, model, onEvent, signal })
    )
  );
  res.status(202).json({ step: "plan", status: "running" });
});

// Promotes a /test-content-plan scratch result straight into a real project —
// copies master_content.md + scenes.json as-is and marks "plan" done, WITHOUT a
// second LLM call. Exists so testing a profile's contentPlaybook (see
// TestScriptPreview.jsx) doesn't mean paying for the same script twice: once to
// preview it, once more for the real project. Deliberately copies the file
// UNMODIFIED — if the user hand-edited the preview text, scenes.json (the file
// generate-audio.mjs actually reads for narration/timing) would silently stay on
// the OLD unedited cut, diverging from what they saw on screen; the client is
// expected to only offer this button for an untouched (read-only) preview.
router.post("/projects/:id/plan/use-test-result", withProjectDir, (req, res) => {
  const { testId, profileSlug } = req.body ?? {};
  if (!testId) return res.status(400).json({ error: "testId is required" });
  setProjectProfile(req.projectDir, profileSlug);
  let testDir;
  try {
    testDir = resolveBatchDir(testId);
  } catch (err) {
    if (err instanceof InvalidBatchIdError) return res.status(400).json({ error: err.message });
    throw err;
  }
  const mcPath = join(testDir, "master_content.md");
  const scenesPath = join(testDir, "scenes.json");
  if (!existsSync(mcPath) || !existsSync(scenesPath)) {
    return res.status(400).json({ error: "Kết quả test chưa sẵn sàng hoặc đã bị dọn — chạy test lại." });
  }
  writeFileSync(join(req.projectDir, "master_content.md"), readFileSync(mcPath, "utf-8"));
  writeFileSync(join(req.projectDir, "scenes.json"), readFileSync(scenesPath, "utf-8"));
  emitProgress(req.projectDir, { step: "plan", status: "done" });
  res.json({ step: "plan", status: "done" });
});

// "Bảng điều tra" tab (Investigation.jsx) — replaces content-planner's job with a
// specialized investigative-narrative writer, but produces the EXACT SAME
// master_content.md + scenes.json shape, so everything downstream (audio/TTS,
// video-plan, scene, root, render) runs completely unmodified. Step key
// "investigation-plan" (not "plan") — calls `runStep` directly (not the usual
// `runInBackground` wrapper, whose `.catch(() => {})` would swallow the failure and
// mark "plan" done even when the real write failed) so `steps.plan` is only faked
// done AFTER genuine success, same precedent as `/audio-import` below. Unlike
// `/audio-import`, only "plan" is faked — "audio" is NOT, since this feature only
// replaces the content step; the real TTS step still runs normally once the user
// lands in Pipeline.jsx.
router.post("/projects/:id/investigation-plan", withProjectDir, (req, res) => {
  const { idea, audience, platform, targetDuration, model, profileSlug } = req.body ?? {};
  if (!idea) return res.status(400).json({ error: "idea is required" });
  if (!audience) return res.status(400).json({ error: "audience is required" });
  const contentPlaybook = profileSlug ? listProfiles().find((p) => p.slug === profileSlug)?.contentPlaybook : undefined;
  setProjectProfile(req.projectDir, profileSlug);

  runStep(req.projectDir, "investigation-plan", (onEvent, signal) =>
    queues.dashscope.run(() =>
      runInvestigationContentPlanner({ idea, projectDir: req.projectDir, audience, platform, targetDuration, contentPlaybook, model, onEvent, signal })
    )
  )
    .then(() => {
      emitProgress(req.projectDir, { step: "plan", status: "done" });
    })
    .catch(() => {
      /* already recorded as an "investigation-plan" error by runStep — "plan" stays unmarked */
    });

  res.status(202).json({ step: "investigation-plan", status: "running" });
});

// "Dán kịch bản có sẵn" — user's own already-written script, model ONLY cuts scene
// boundaries (see script-scene-cutter.mjs's own doc comment on why narration is
// reconstructed in code, never retyped by the model). Same "fake plan done, leave
// audio real" pattern as /investigation-plan above.
router.post("/projects/:id/script-plan", withProjectDir, (req, res) => {
  const { scriptText, platform, profileSlug } = req.body ?? {};
  if (!scriptText?.trim()) return res.status(400).json({ error: "scriptText is required" });
  setProjectProfile(req.projectDir, profileSlug);

  // No LLM call at all — see script-scene-cutter.mjs's own doc comment — so this
  // doesn't need queues.dashscope (that queue is for rate-limiting real API calls).
  runStep(req.projectDir, "script-plan", (onEvent) => runScriptSceneCutter({ projectDir: req.projectDir, scriptText, platform, onEvent }))
    .then(() => {
      emitProgress(req.projectDir, { step: "plan", status: "done" });
    })
    .catch(() => {
      /* already recorded as a "script-plan" error by runStep — "plan" stays unmarked */
    });

  res.status(202).json({ step: "script-plan", status: "running" });
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

// "Tạo từ audio có sẵn" — replaces steps "plan" + "audio" in one go (transcribe →
// cắt cảnh theo ý nghĩa → cắt audio gốc theo từng cảnh), producing the exact same
// scenes.json/scenes-with-timing.json shape those 2 steps normally produce. Calls
// `runStep` directly instead of the usual `runInBackground` wrapper — every other
// route in this file uses that wrapper's `.catch(() => {})`, which turns a failed
// step into a silently-resolved promise; this route specifically needs to know
// whether the real work SUCCEEDED before it's safe to mark "plan"/"audio" done, so
// swallowing the error here would mark them done even on failure.
router.post("/projects/:id/audio-import", withProjectDir, audioImportUpload.single("audio"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "audio file is required (field name: audio)" });
  const { language, whisperModel, model, platform, musicTrack, musicVolume } = req.body ?? {};

  runStep(req.projectDir, "audio-import", (onEvent, signal) =>
    queues.audioImport.run(() =>
      runAudioImport({
        projectDir: req.projectDir,
        sourceFile: req.file.path,
        language: language || undefined,
        whisperModel: whisperModel || undefined,
        model: model || undefined,
        platform: platform || undefined,
        musicTrack: musicTrack || undefined,
        musicVolume: musicVolume !== undefined ? Number(musicVolume) / 100 : undefined,
        onEvent,
        signal,
      })
    )
  )
    .then(() => {
      // Same precedent as `/remix` above marking "video-plan" done for a step it
      // never literally ran through its own route — the real work already happened
      // under the "audio-import" step name; this just satisfies Pipeline.jsx's
      // unmodified gating (which only ever checks steps.plan/steps.audio).
      emitProgress(req.projectDir, { step: "plan", status: "done" });
      emitProgress(req.projectDir, { step: "audio", status: "done" });
    })
    .catch(() => {
      /* already recorded as an "audio-import" error by runStep — plan/audio stay unmarked */
    });

  res.status(202).json({ step: "audio-import", status: "running" });
});

router.post("/projects/:id/video-plan", withProjectDir, (req, res) => {
  const {
    visualStyle, template, subStyle, imageStylePrefix, fontFamily, model, cheapModel, imageModel,
    imageLibraryEnabled, imageLibraryMaxReuse, profileSlug, kenBurns, grain, footageConfig, format,
    photoProvider,
  } = req.body ?? {};
  setProjectProfile(req.projectDir, profileSlug);

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
        photoProvider,
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
          photoProvider: videoPlan.photoProvider,
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

  // "SFX cuối scene" — already decided per-scene at video-plan time (see
  // build-footage-plan.mjs's applySceneSfx), not re-picked here. Empty for any
  // project/scene that doesn't use it.
  const sfxByScene = Object.fromEntries(
    (videoPlan.scenes ?? [])
      .filter((s) => s.sfxFile && s.sfxDuration)
      .map((s) => [s.sceneId, { file: s.sfxFile, duration: s.sfxDuration }])
  );

  runInBackground(req.projectDir, "root", (onEvent, signal) =>
    queues.dashscope.run(() =>
      runRootComposer({
        projectDir: req.projectDir,
        design,
        scenesWithTiming,
        doneSceneIds,
        format: videoPlan.format,
        template: videoPlan.template,
        sfxByScene,
        model: videoPlan.cheapModel,
        onEvent,
        signal,
      })
    )
  );
  res.status(202).json({ step: "root", status: "running", sceneIds: doneSceneIds });
});

// "Đọc Caption" tab's own 4-step chain — deliberately separate route names/step keys
// from the "plan"/"audio"/"video-plan"/"root" routes above (no audio, no narration,
// always 1 scene) rather than branching those existing routes on `template` — see
// plan.md's "Quyết định kiến trúc" for why this format doesn't share content-planner/
// root-composer at all. `POST /projects/:id/render` above (unchanged) finishes the
// chain — it's already fully generic (just runs `hyperframes render`).
router.post("/projects/:id/hook/content", withProjectDir, (req, res) => {
  const { idea, nicheDescription, ctaText, model } = req.body ?? {};
  if (!idea) return res.status(400).json({ error: "idea is required" });

  runInBackground(req.projectDir, "hook-content", (onEvent, signal) =>
    queues.dashscope.run(() =>
      runHookContentWriter({ projectDir: req.projectDir, idea, nicheDescription, ctaText, model, onEvent, signal })
    )
  );
  res.status(202).json({ step: "hook-content", status: "running" });
});

router.post("/projects/:id/hook/video-plan", withProjectDir, (req, res) => {
  const { format, videoDurationSec, ctaText, highlightColor, blurPercent, footageFolder, footageConfig, musicTrack, musicVolume } = req.body ?? {};
  if (!existsSync(join(req.projectDir, "hook-plan.json"))) {
    return res.status(400).json({ error: "hook-plan.json not found — run /hook/content first" });
  }

  runInBackground(req.projectDir, "hook-video-plan", (onEvent) =>
    buildHookVideoPlan({
      projectDir: req.projectDir,
      format: format || "9:16",
      videoDurationSec: videoDurationSec || 9,
      ctaText,
      highlightColor,
      blurPercent,
      footageFolder,
      footageConfig,
      musicTrack,
      musicVolume,
      onEvent,
    })
  );
  res.status(202).json({ step: "hook-video-plan", status: "running" });
});

router.post("/projects/:id/hook/scene", withProjectDir, (req, res) => {
  const videoPlanFile = join(req.projectDir, "video-plan.json");
  if (!existsSync(videoPlanFile)) return res.status(400).json({ error: "video-plan.json not found — run /hook/video-plan first" });
  const videoPlan = JSON.parse(readFileSync(videoPlanFile, "utf-8"));

  // queues.ffmpeg, not queues.dashscope — no LLM call here, just local ffmpeg
  // processes (same reasoning as the "footage" template's own scene route).
  runInBackground(req.projectDir, "hook-scene", (onEvent, signal) =>
    queues.ffmpeg.run(() =>
      runHookSceneWriter({
        projectDir: req.projectDir,
        format: videoPlan.format,
        videoDurationSec: videoPlan.total_duration,
        hookContent: videoPlan.hookContent,
        ctaText: videoPlan.ctaText,
        highlightColor: videoPlan.highlightColor,
        blurPercent: videoPlan.blurPercent,
        footageFolder: videoPlan.footageFolder,
        footageConfig: videoPlan.footageConfig,
        onEvent,
        signal,
      })
    )
  );
  res.status(202).json({ step: "hook-scene", status: "running" });
});

router.post("/projects/:id/hook/root", withProjectDir, (req, res) => {
  const videoPlanFile = join(req.projectDir, "video-plan.json");
  if (!existsSync(videoPlanFile)) return res.status(400).json({ error: "video-plan.json not found — run /hook/video-plan first" });
  const videoPlan = JSON.parse(readFileSync(videoPlanFile, "utf-8"));

  const { steps } = readJobStatus(req.projectDir);
  if (steps["hook-scene"]?.status !== "done") {
    return res.status(400).json({ error: "Scene chưa generate xong — chạy /hook/scene trước" });
  }

  runInBackground(req.projectDir, "hook-root", (onEvent) =>
    buildHookRoot({
      projectDir: req.projectDir,
      format: videoPlan.format,
      videoDurationSec: videoPlan.total_duration,
      musicTrack: videoPlan.musicTrack,
      musicVolume: videoPlan.musicVolume,
      onEvent,
    })
  );
  res.status(202).json({ step: "hook-root", status: "running" });
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

// "Xuất gọn" — see lib/export-ready.mjs's own doc comment. Synchronous (a file copy
// + small text write, not an LLM call) — no job-status/SSE plumbing needed.
router.post("/projects/:id/export", withProjectDir, (req, res) => {
  try {
    res.json(exportProject(toProjectId(req.projectDir)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/export-ready-all", (req, res) => {
  try {
    const results = exportAllReady();
    res.json({ results, exportDir: EXPORT_DIR });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/export-ready-all/open-folder", async (req, res) => {
  try {
    mkdirSync(EXPORT_DIR, { recursive: true });
    await openInFileManager(EXPORT_DIR);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Publish the finished render as a Facebook Reel on the project's channel profile's
// Page — called from the standalone "Đăng bài" tab (web/src/components/Publish.jsx),
// NOT from Pipeline.jsx (user explicitly wants posting kept separate from the
// per-project creation flow, since this tool's whole point is running many projects in
// bulk). `renderName` optional — defaults to the newest render, same "renders[0]"
// convention already used by RenderPlayer.jsx/History.jsx/Hook.jsx.
router.post("/projects/:id/publish-facebook-reel", withProjectDir, async (req, res) => {
  const { description, renderName } = req.body ?? {};
  const profileSlug = readJobStatus(req.projectDir).profileSlug;
  const profile = profileSlug ? listProfiles().find((p) => p.slug === profileSlug) : null;
  if (!profile?.facebookPageId) {
    return res.status(400).json({ error: "Project này chưa gắn với profile có Facebook Page — vào Hồ sơ kênh cấu hình Page ID cho profile." });
  }
  const pageAccessToken = getPageAccessToken(profileSlug);
  if (!pageAccessToken) {
    return res.status(400).json({ error: `Profile "${profile.name}" chưa lưu Facebook Page Access Token — vào Hồ sơ kênh.` });
  }

  const rendersDir = join(req.projectDir, "renders");
  let name = renderName;
  if (!name) {
    const renders = existsSync(rendersDir)
      ? readdirSync(rendersDir).filter((f) => f.endsWith(".mp4") && !f.startsWith("._")).map((f) => ({ name: f, mtime: statSync(join(rendersDir, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime)
      : [];
    name = renders[0]?.name;
  }
  if (!name) return res.status(400).json({ error: "Chưa có render nào — chạy bước Render trước." });
  const videoPath = join(rendersDir, name);
  if (!existsSync(videoPath)) return res.status(404).json({ error: `Render "${name}" không tồn tại` });

  let durationSec;
  try {
    durationSec = await probeDuration(videoPath);
  } catch (err) {
    return res.status(400).json({ error: `Không đọc được thời lượng video: ${err.message}` });
  }
  if (durationSec < 3 || durationSec > 90) {
    return res.status(400).json({
      error: `Facebook Reels yêu cầu video dài 3–90 giây — video này dài ${durationSec.toFixed(1)}s.`,
    });
  }

  runInBackground(req.projectDir, "publish-facebook", (onEvent, signal) =>
    publishReelToFacebook({ pageId: profile.facebookPageId, pageAccessToken, videoPath, description, onEvent, signal })
  );
  res.status(202).json({ step: "publish-facebook", status: "running" });
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

// "Đọc Caption" tab's per-profile footage folder override (see lib/hook-profiles.mjs's
// `footageFolder`) — separate route from the one above (which always scans the shared
// pool) so Hook.jsx can check "does this custom path actually have media in it" before
// the user runs a real generation. Counts images/videos separately since that's the
// whole point of the check (confirming the mix, not just a raw file count).
router.get("/footage-library/scan", async (req, res) => {
  const dir = req.query.dir;
  if (!dir) return res.status(400).json({ error: "dir is required" });
  // Found live (user report): a relative path like "assets/footage-library/xyz" (the
  // same style the shared pool's OWN default is documented/shown as everywhere in the
  // UI) resolved against THIS PROCESS's cwd (server/, per package.json's `npm start`),
  // not the workspace root — landing on a nonexistent server/assets/... and always
  // reporting "Thư mục không tồn tại" even for a real folder. Resolve non-absolute
  // input against the workspace root here, same convention scanFootageLibrary() now
  // applies internally (see footage-library.mjs) so this pre-check and the real scan
  // agree on the same resolved path.
  const resolvedDir = isAbsolute(dir) ? dir : resolve(import.meta.dirname, "..", dir);
  // scanFootageLibrary() itself mkdir's a missing dir (correct for the real
  // generation path — the shared library should always exist) — but this route is
  // hit live while the user is still typing/pasting a path, so a typo shouldn't
  // create a stray folder on their disk. Check first, don't let the scan do it.
  if (!existsSync(resolvedDir)) return res.json({ count: 0, images: 0, videos: 0, error: "Thư mục không tồn tại" });
  try {
    const files = await scanFootageLibrary(resolvedDir, { includeImages: true });
    const images = files.filter((f) => f.kind === "image").length;
    const videos = files.filter((f) => f.kind === "video").length;
    res.json({ count: files.length, images, videos });
  } catch (err) {
    res.json({ count: 0, images: 0, videos: 0, error: err.message });
  }
});

// Fetches real stock footage straight from Pexels Videos into a footage-library
// folder by keyword — same PEXELS_API_KEY already used for still photos
// (providers/image/pexels.mjs), just a different endpoint/response shape. Found
// live (user request): the env var already existed but nothing called the video
// search endpoint, so "footage" template users had no way to populate a folder
// except manually downloading clips one by one. Synchronous (not runInBackground/
// SSE) — a handful of short HTTP downloads, not an LLM call, no need for the
// job-status machinery.
router.post("/footage-library/fetch-pexels", async (req, res) => {
  const { query, dir, format, count } = req.body ?? {};
  // `query` may be a single string OR an array of keywords (comma-separated text
  // from the client is split there before this route sees it) — see
  // pexels-video.mjs's own doc comment for why several narrow keywords each
  // searched separately beats one broad LLM-suggested phrase.
  const keywords = (Array.isArray(query) ? query : [query]).map((q) => q?.trim()).filter(Boolean);
  if (!keywords.length) return res.status(400).json({ error: "query is required" });
  if (!dir?.trim()) return res.status(400).json({ error: "dir is required" });
  // Multiple keywords × count each can genuinely take a while (each is its own
  // search + N sequential downloads) — found live (user request): with no way to
  // stop mid-fetch, a bad keyword pick meant sitting through the whole thing. The
  // client aborts its own fetch() on "Dừng"; that alone doesn't stop OUR work
  // server-side (Express keeps executing the handler), so tie an AbortController to
  // `res`'s own "close" event and pass it into searchAndSaveVideos, which already
  // threads a signal through to every download (see pexels-video.mjs). MUST be
  // `res.on("close")`, not `req.on("close")` — confirmed live: the request stream's
  // own "close" fires as soon as its (already-buffered, tiny JSON) body finishes
  // being read, well before any real client disconnect, aborting every request
  // instantly. `res` only closes when the underlying connection actually ends.
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const destDir = resolveLibraryDir(dir.trim());
    const result = await searchAndSaveVideos({ query: keywords, format, count, destDir, signal: controller.signal });
    if (!res.writableEnded) res.json(result);
  } catch (err) {
    if (!res.writableEnded) res.status(err instanceof CancelledError ? 499 : 500).json({ error: err.message });
  }
});

// Suggests an English search keyword for the Pexels Videos fetch above, derived from
// the profile's own channelTheme/contentPlaybook — Pexels search works far better in
// English than Vietnamese, and users setting up a channel profile shouldn't have to
// hand-translate their own niche description into stock-footage search terms
// themselves. One-shot chatCompletion (not the full agent/tool loop — nothing to
// write to disk here), CHEAP_MODEL since this is a short answer, not real content.
//
// Returns SEVERAL short keywords (not 1 broad phrase) — found live (user feedback):
// a single specific phrase like "man working hard" matches far fewer real Pexels
// videos than several short, generic keywords (gym, running, discipline...) each
// searched separately. See pexels-video.mjs's searchAndSaveVideos for the "1 call
// per keyword" fetch side of this.
router.post("/footage-library/suggest-keyword", async (req, res) => {
  const { channelTheme, contentPlaybook } = req.body ?? {};
  if (!channelTheme?.trim() && !contentPlaybook?.trim()) {
    return res.status(400).json({ error: "Cần có channelTheme hoặc contentPlaybook để gợi ý từ khoá" });
  }
  try {
    const response = await chatCompletion({
      model: CHEAP_MODEL,
      messages: [
        {
          role: "user",
          content: `Kênh video ngắn có chủ đề: "${channelTheme ?? ""}"${
            contentPlaybook?.trim() ? `\nĐịnh hướng nội dung: "${contentPlaybook.trim()}"` : ""
          }\n\nGợi ý 5-10 từ khoá tiếng Anh NGẮN (1-2 từ mỗi từ khoá, vd "gym", "running", "hard work", "discipline") để
tìm B-roll/stock footage trên Pexels Videos cho kênh này — mỗi từ khoá sẽ được search
RIÊNG LẺ nên phải đủ PHỔ BIẾN/CHUNG CHUNG để ra nhiều kết quả thật trên Pexels, KHÔNG
ghép thành 1 cụm dài cụ thể (vd "man working hard in the morning" là SAI — quá cụ thể,
gần như không ra kết quả). Chỉ trả về đúng danh sách từ khoá, cách nhau bằng dấu phẩy,
không đánh số, không giải thích, không dấu ngoặc kép.`,
        },
      ],
    });
    const raw = response.choices?.[0]?.message?.content?.trim() ?? "";
    const keywords = raw
      .split(",")
      .map((k) => k.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    if (!keywords.length) return res.status(500).json({ error: "Model không trả về từ khoá" });
    res.json({ keywords });
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
