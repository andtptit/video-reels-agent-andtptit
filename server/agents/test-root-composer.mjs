#!/usr/bin/env node
/**
 * Standalone smoke test for the root-composer agent task.
 * Usage: node --env-file=.env server/agents/test-root-composer.mjs <projectDir> [sceneId ...]
 * If no sceneIds are passed, uses every scene that has a compositions/scene_XX.html file.
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { runRootComposer } from "./root-composer.mjs";

const [projectDir, ...sceneIdsArg] = process.argv.slice(2);
if (!projectDir) {
  console.error("Usage: node --env-file=.env server/agents/test-root-composer.mjs <projectDir> [sceneId ...]");
  process.exit(1);
}

const design = readFileSync(join(projectDir, "DESIGN.md"), "utf-8");
const scenesWithTiming = JSON.parse(readFileSync(join(projectDir, "scenes-with-timing.json"), "utf-8"));
const videoPlan = JSON.parse(readFileSync(join(projectDir, "video-plan.json"), "utf-8"));

const doneSceneIds = sceneIdsArg.length
  ? sceneIdsArg
  : readdirSync(join(projectDir, "compositions"))
      .filter((f) => f.endsWith(".html"))
      .map((f) => f.replace(/\.html$/, ""));

if (!doneSceneIds.length) {
  console.error("No scene compositions found — generate at least one scene first");
  process.exit(1);
}

console.log(`\nRoot-composer (DashScope) → ${projectDir}/ [${doneSceneIds.join(", ")}]\n`);

const result = await runRootComposer({
  projectDir,
  design,
  scenesWithTiming,
  doneSceneIds,
  format: videoPlan.format,
  template: videoPlan.template,
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

console.log(`\n=== ${result.ok ? "PASS" : "FAILED"} sau ${result.attempts} attempt(s) ===`);
if (result.usage) console.log(`  token: ${result.usage.totalTokens} (prompt ${result.usage.promptTokens} + completion ${result.usage.completionTokens})`);
if (!result.ok) console.log(JSON.stringify(result.newFindings, null, 2));
if (result.staticWarnings?.length) {
  console.log(`  warn  ${result.staticWarnings.length} static warning(s) (pseudo-element animation):`);
  console.log(JSON.stringify(result.staticWarnings, null, 2));
}
