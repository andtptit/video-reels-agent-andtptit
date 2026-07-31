#!/usr/bin/env node
/**
 * Standalone smoke test for the scene-writer agent task.
 * Usage: node --env-file=.env server/agents/test-scene-writer.mjs <projectDir> <sceneId>
 */
import { readFileSync } from "fs";
import { join } from "path";
import { runSceneWriter } from "./scene-writer.mjs";

const [projectDir, sceneId] = process.argv.slice(2);
if (!projectDir || !sceneId) {
  console.error("Usage: node --env-file=.env server/agents/test-scene-writer.mjs <projectDir> <sceneId>");
  process.exit(1);
}

const design = readFileSync(join(projectDir, "DESIGN.md"), "utf-8");
const videoPlan = JSON.parse(readFileSync(join(projectDir, "video-plan.json"), "utf-8"));
const scene = videoPlan.scenes.find((s) => s.sceneId === sceneId);
if (!scene) {
  console.error(`Scene "${sceneId}" not found in video-plan.json`);
  process.exit(1);
}

console.log(`\nScene-writer (DashScope) → ${projectDir}/ [${sceneId}]\n`);

const result = await runSceneWriter({
  projectDir,
  scene,
  design,
  onEvent: (evt) => {
    if (evt.type === "assistant" && evt.message.tool_calls) {
      for (const call of evt.message.tool_calls) console.log(`  [turn ${evt.turn}] tool_call → ${call.function.name}`);
    }
    if (evt.type === "tool") {
      console.log(`  [turn ${evt.turn}] ${evt.name} → ${evt.result.ok ? "ok" : "FAILED: " + evt.result.error}`);
    }
    if (evt.type === "lint") {
      console.log(`  --- lint attempt ${evt.attempt}: ${evt.newFindingCount} new finding(s) ---`);
    }
  },
});

console.log(`\n=== ${result.ok ? "PASS" : "FAILED"} sau ${result.attempts} attempt(s) — ${result.outPath} ===`);
if (!result.ok) console.log(JSON.stringify(result.newFindings, null, 2));
