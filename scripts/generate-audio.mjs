#!/usr/bin/env node
/**
 * Audio Generation Pipeline (CLI wrapper — logic lives in server/pipeline/generate-audio.mjs
 * so the same code path also backs `POST /projects/:id/audio`)
 *
 * Usage:
 *   node --env-file=.env scripts/generate-audio.mjs <project-path>
 *
 * Expects: <project-path>/scenes.json  (hoặc plans.json)
 * Outputs: <project-path>/scenes-with-timing.json
 *          <project-path>/assets/audio/*.mp3   (voiceover + timing JSON)
 *          <project-path>/assets/sfx/*.mp3     (copied from workspace library)
 *          <project-path>/assets/music/*.mp3   (copied from workspace library)
 */
import { resolve } from "path";
import { runGenerateAudio } from "../server/pipeline/generate-audio.mjs";

const [projectPath] = process.argv.slice(2);
if (!projectPath) {
  console.error("Usage: node --env-file=.env scripts/generate-audio.mjs <project-path>");
  process.exit(1);
}

const providerId = process.env.TTS_PROVIDER || "elevenlabs";
console.log(`\nAudio generation → ${projectPath}/\n`);
console.log(`  provider  ${providerId}\n`);

function onEvent(evt) {
  switch (evt.type) {
    case "scene-start":
      process.stdout.write(`\n[${evt.sceneId}]\n  tts[${providerId}]   ${evt.sceneId} "${evt.narration.slice(0, 45)}..." `);
      break;
    case "scene-skip":
      console.log(`\n[${evt.sceneId}]\n  skip  ${evt.sceneId} voiceover (already exists)`);
      break;
    case "scene-tts-done":
      console.log(`ok (~${evt.voDuration.toFixed(2)}s, ${(evt.audioBytes / 1024).toFixed(0)} KB)`);
      break;
    case "scene-error":
      console.error(`FAILED: ${evt.error}`);
      break;
    case "anchor-not-found":
      console.log(`  warn  anchor '${evt.target}' not found in timestamps`);
      break;
    case "scene-done":
      console.log(`  duration: ${evt.voDuration.toFixed(2)}s VO → ${evt.sceneDuration}s scene`);
      break;
    case "music-selected":
      console.log(`\n  music  → ${evt.track}.mp3`);
      break;
    case "sfx-copied":
      console.log(`  copy  assets/sfx/${evt.id}.mp3`);
      break;
    case "sfx-missing":
      console.warn(`  warn  SFX not in library: ${evt.id}`);
      break;
    case "music-copied":
      console.log(`  copy  assets/music/${evt.track}.mp3`);
      break;
    case "done":
      console.log(`\nSaved: ${projectPath}/scenes-with-timing.json`);
      console.log(`Total duration: ${evt.totalDuration.toFixed(1)}s`);
      if (evt.failedSceneIds?.length) {
        console.error(`\nWARN: ${evt.failedSceneIds.length} scene(s) missing real audio/captions: ${evt.failedSceneIds.join(", ")} — chạy lại script này để retry (scene đã xong sẽ được bỏ qua).`);
      }
      console.log("Next: /video-planner → đọc scenes-with-timing.json → viết video-plan.json\n");
      break;
  }
}

try {
  await runGenerateAudio(resolve(projectPath), { ttsProvider: providerId, onEvent });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
