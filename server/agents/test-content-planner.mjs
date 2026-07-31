#!/usr/bin/env node
/**
 * Standalone smoke test for the content-planner agent task — run this BEFORE
 * wiring up any UI/API layer, to validate DashScope's output quality against the
 * real SKILL.md instructions.
 *
 * Usage:
 *   node --env-file=.env server/agents/test-content-planner.mjs "<idea>" [projectDir]
 */
import { runContentPlanner } from "./content-planner.mjs";

const [idea, projectDir = "scratchpad-content-planner-test"] = process.argv.slice(2);
if (!idea) {
  console.error('Usage: node --env-file=.env server/agents/test-content-planner.mjs "<idea>" [projectDir]');
  process.exit(1);
}

console.log(`\nContent-planner (DashScope) → ${projectDir}/\n`);

const result = await runContentPlanner({
  idea,
  projectDir,
  audience: "Người làm marketing/content muốn tiết kiệm thời gian bằng AI",
  platform: "9:16",
  targetDuration: "30–60s",
  onEvent: (evt) => {
    if (evt.type === "assistant" && evt.message.tool_calls) {
      for (const call of evt.message.tool_calls) {
        console.log(`  [turn ${evt.turn}] tool_call → ${call.function.name}`);
      }
    }
    if (evt.type === "tool") {
      console.log(`  [turn ${evt.turn}] ${evt.name} → ${evt.result.ok ? "ok" : "FAILED: " + evt.result.error}`);
    }
  },
});

console.log(`\n=== Xong sau ${result.turns} turn ===`);
console.log(result.finalMessage);
