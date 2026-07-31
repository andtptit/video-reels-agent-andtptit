#!/usr/bin/env node
/**
 * Standalone smoke test for the video-planner agent task.
 * Usage: node --env-file=.env server/agents/test-video-planner.mjs <projectDir>
 */
import { runVideoPlanner } from "./video-planner.mjs";

const [projectDir] = process.argv.slice(2);
if (!projectDir) {
  console.error("Usage: node --env-file=.env server/agents/test-video-planner.mjs <projectDir>");
  process.exit(1);
}

console.log(`\nVideo-planner (DashScope) → ${projectDir}/\n`);

const result = await runVideoPlanner({
  projectDir,
  onEvent: (evt) => {
    if (evt.type === "assistant" && evt.message.tool_calls) {
      for (const call of evt.message.tool_calls) console.log(`  [turn ${evt.turn}] tool_call → ${call.function.name}`);
    }
    if (evt.type === "tool") {
      console.log(`  [turn ${evt.turn}] ${evt.name} → ${evt.result.ok ? "ok" : "FAILED: " + evt.result.error}`);
    }
  },
});

console.log(`\n=== Xong sau ${result.turns} turn ===`);
console.log(result.finalMessage);
if (result.durationCheck && !result.durationCheck.ok) {
  console.log(`  warn  total_duration lệch tổng scene: ${JSON.stringify(result.durationCheck)}`);
}
