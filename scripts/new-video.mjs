#!/usr/bin/env node
import { execSync } from "child_process";
import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join } from "path";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const ROOT = join(import.meta.dirname, "..");

const rl = readline.createInterface({ input, output });
const idea = (await rl.question("Ý tưởng video: ")).trim();
rl.close();

if (!idea) {
  console.error("Cần nhập ý tưởng.");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

const slug = idea
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/đ/gi, "d")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 50);

const projectPath = `output/${today}/${slug}/video`;

if (existsSync(join(ROOT, projectPath))) {
  console.error(`Thư mục đã tồn tại: ${projectPath}`);
  process.exit(1);
}

mkdirSync(join(ROOT, `output/${today}/${slug}`), { recursive: true });

console.log(`\nKhởi tạo project: ${projectPath}\n`);
execSync(`npx hyperframes init ${projectPath}`, { stdio: "inherit", cwd: ROOT });

const designSrc = join(ROOT, "DESIGN.md");
if (existsSync(designSrc)) {
  copyFileSync(designSrc, join(ROOT, projectPath, "DESIGN.md"));
  console.log("\n  → DESIGN.md copied");
}
