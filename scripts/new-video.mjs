#!/usr/bin/env node
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { createProject } from "../server/pipeline/new-project.mjs";

const rl = readline.createInterface({ input, output });
const idea = (await rl.question("Ý tưởng video: ")).trim();
const orientationAnswer = (await rl.question("Định dạng — ngang/dọc (mặc định dọc): ")).trim().toLowerCase();
rl.close();

const orientation = orientationAnswer.startsWith("ngang") ? "landscape" : "portrait";

try {
  console.log(`\nKhởi tạo project (${orientation})...\n`);
  const { projectPath, designCopied } = createProject(idea, { orientation });
  console.log(`Project: ${projectPath}`);
  if (designCopied) console.log("  → DESIGN.md copied");
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
