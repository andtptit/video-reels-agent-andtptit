#!/usr/bin/env node
/**
 * Generates music library via ElevenLabs Sound Generation API.
 * Run once: node --env-file=.env scripts/setup-music-library.mjs
 * Output:   assets/music/*.mp3
 */
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) { console.error("Missing ELEVENLABS_API_KEY in .env"); process.exit(1); }

const OUT_DIR = join(ROOT, "assets/music");
mkdirSync(OUT_DIR, { recursive: true });

const TRACKS = [
  {
    id: "upbeat-tech",
    moods: ["explosive", "snappy"],
    prompt: "Upbeat electronic technology background music, energetic driving beat, synth bass, no vocals, loop-friendly, modern and dynamic",
    duration: 22,
  },
  {
    id: "cinematic-dark",
    moods: ["cinematic"],
    prompt: "Dark cinematic background music, atmospheric tension, slow-building orchestral synth, dramatic, no vocals, loop-friendly",
    duration: 22,
  },
  {
    id: "fluid-ambient",
    moods: ["fluid"],
    prompt: "Calm fluid ambient electronic music, smooth flowing pads, gentle pulse, peaceful and modern, no vocals, loop-friendly",
    duration: 22,
  },
  {
    id: "technical-pulse",
    moods: ["technical"],
    prompt: "Technical minimal electronic music, steady rhythmic pulse, clean and precise, digital feel, no vocals, loop-friendly",
    duration: 22,
  },
];

async function generate(track) {
  const dest = join(OUT_DIR, `${track.id}.mp3`);
  if (existsSync(dest)) { console.log(`  skip  ${track.id} (already exists)`); return; }

  process.stdout.write(`  gen   ${track.id} [${track.moods.join(", ")}] ... `);
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text: track.prompt, duration_seconds: track.duration, prompt_influence: 0.5 }),
  });

  if (!res.ok) { console.error(`FAILED (${res.status}): ${await res.text()}`); return; }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`ok (${(buf.length / 1024).toFixed(0)} KB)`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\nGenerating ${TRACKS.length} music tracks → assets/music/\n`);
for (const track of TRACKS) { await generate(track); await sleep(1500); }

console.log("\nMood → Track mapping:");
for (const t of TRACKS) t.moods.forEach((m) => console.log(`  ${m.padEnd(16)} → ${t.id}.mp3`));
console.log("\nDone.");
