#!/usr/bin/env node
/**
 * Generates SFX library via ElevenLabs Sound Generation API.
 * Run once: node --env-file=.env scripts/setup-sfx-library.mjs
 * Output:   assets/sfx/*.mp3
 */
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) { console.error("Missing ELEVENLABS_API_KEY in .env"); process.exit(1); }

const OUT_DIR = join(ROOT, "assets/sfx");
mkdirSync(OUT_DIR, { recursive: true });

const SFX = [
  { id: "drum-hit",      prompt: "Single sharp punchy drum rimshot hit, short, no reverb tail",                    duration: 1.0 },
  { id: "whoosh",        prompt: "Fast cinematic whoosh, air movement, sweeping, short",                           duration: 1.0 },
  { id: "whoosh-soft",   prompt: "Soft subtle whoosh, gentle air movement, smooth fade",                           duration: 1.0 },
  { id: "ding",          prompt: "Single bright clear ding notification bell, pleasant, short",                    duration: 1.0 },
  { id: "click",         prompt: "Single crisp UI click sound, clean and digital, very short",                     duration: 0.5 },
  { id: "impact",        prompt: "Heavy cinematic impact thud with short reverb, powerful",                        duration: 1.5 },
  { id: "chime",         prompt: "Soft melodic chime bell tone, warm and gentle, short",                           duration: 1.5 },
  { id: "count-up-end",  prompt: "Rising electronic arpeggio resolving upward, like a counter completing",         duration: 1.5 },
];

async function generate(sfx) {
  const dest = join(OUT_DIR, `${sfx.id}.mp3`);
  if (existsSync(dest)) { console.log(`  skip  ${sfx.id} (already exists)`); return; }

  process.stdout.write(`  gen   ${sfx.id} ... `);
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text: sfx.prompt, duration_seconds: sfx.duration, prompt_influence: 0.3 }),
  });

  if (!res.ok) { console.error(`FAILED (${res.status}): ${await res.text()}`); return; }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`ok (${(buf.length / 1024).toFixed(0)} KB)`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\nGenerating ${SFX.length} SFX → assets/sfx/\n`);
for (const sfx of SFX) { await generate(sfx); await sleep(600); }
console.log("\nDone.");
