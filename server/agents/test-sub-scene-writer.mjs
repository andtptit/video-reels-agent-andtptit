#!/usr/bin/env node
/**
 * Standalone smoke test for the sub-scene-writer task (video-plan.json's
 * template === "sub" path — deterministic, no LLM for the composition HTML).
 * Usage: node --env-file=.env server/agents/test-sub-scene-writer.mjs <projectDir> <sceneId>
 */
import { readFileSync } from "fs";
import { join } from "path";
import { runSubSceneWriter } from "./sub-scene-writer.mjs";

const [projectDir, sceneId] = process.argv.slice(2);
if (!projectDir || !sceneId) {
  console.error("Usage: node --env-file=.env server/agents/test-sub-scene-writer.mjs <projectDir> <sceneId>");
  process.exit(1);
}

const videoPlan = JSON.parse(readFileSync(join(projectDir, "video-plan.json"), "utf-8"));
const scene = videoPlan.scenes.find((s) => s.sceneId === sceneId);
if (!scene) {
  console.error(`Scene "${sceneId}" not found in video-plan.json`);
  process.exit(1);
}

const scenesWithTiming = JSON.parse(readFileSync(join(projectDir, "scenes-with-timing.json"), "utf-8"));
const sceneTiming = scenesWithTiming.scenes.find((s) => s.sceneId === sceneId);
if (!sceneTiming) {
  console.error(`Scene "${sceneId}" not found in scenes-with-timing.json`);
  process.exit(1);
}

console.log(`\nSub-scene-writer (no LLM) → ${projectDir}/ [${sceneId}, style=${videoPlan.subStyle}]\n`);

const result = await runSubSceneWriter({
  projectDir,
  scene,
  sceneTiming,
  format: videoPlan.format,
  subStyle: videoPlan.subStyle,
  onEvent: (evt) => console.log(`  ${evt.type} → ${evt.outPath}`),
});

console.log(`\n=== ${result.ok ? "PASS" : "FAILED"} — ${result.outPath} ===`);
if (!result.ok) console.log(JSON.stringify(result.findings ?? result.error, null, 2));
