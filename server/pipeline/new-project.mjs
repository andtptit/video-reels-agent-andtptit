/**
 * Project scaffolding logic — shared by scripts/new-video.mjs (interactive CLI) and
 * routes.mjs (`POST /projects`). Extracted so the two entry points can't drift: same
 * slug rules, same `npx hyperframes init`, same DESIGN.md copy.
 */
import { execSync } from "child_process";
import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..", "..");

export function slugify(idea) {
  return idea
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

const ORIENTATIONS = {
  portrait: { resolution: "portrait", platform: "9:16" },
  landscape: { resolution: "landscape", platform: "16:9" },
};

/**
 * @param {string} idea
 * @param {{ orientation?: "portrait" | "landscape" }} [opts] - default "portrait",
 *   matches CLAUDE.md's default short-form vertical convention (9:16).
 * @returns {{ projectPath: string, projectDir: string, designCopied: boolean, platform: string }}
 */
export function createProject(idea, { orientation = "portrait" } = {}) {
  const trimmed = (idea ?? "").trim();
  if (!trimmed) throw new Error("Cần nhập ý tưởng.");

  const orientationSpec = ORIENTATIONS[orientation];
  if (!orientationSpec) throw new Error(`Orientation không hợp lệ: ${orientation} (chỉ nhận "portrait" | "landscape")`);

  const today = new Date().toISOString().slice(0, 10);
  const slug = slugify(trimmed);
  if (!slug) throw new Error("Ý tưởng không tạo được slug hợp lệ.");

  const projectPath = `output/${today}/${slug}/video`;
  if (existsSync(join(ROOT, projectPath))) {
    throw new Error(`Thư mục đã tồn tại: ${projectPath}`);
  }

  mkdirSync(join(ROOT, `output/${today}/${slug}`), { recursive: true });
  // --example blank --non-interactive: `hyperframes init` prompts for a starter
  // template when run with a TTY (fine for scripts/new-video.mjs's CLI use), but the
  // API path (routes.mjs) has no TTY and would otherwise fail with "Non-interactive
  // init requires --example, --video, or --audio" — confirmed live while wiring up
  // POST /projects.
  // --resolution portrait|landscape: sets the canvas dimensions (1080x1920 /
  // 1920x1080) at scaffold time — matches the `platform` value passed to
  // content-planner below so the two never disagree.
  execSync(
    `npx hyperframes init ${projectPath} --example blank --non-interactive --resolution ${orientationSpec.resolution}`,
    { stdio: "pipe", cwd: ROOT }
  );

  const designSrc = join(ROOT, "DESIGN.md");
  const designCopied = existsSync(designSrc);
  if (designCopied) copyFileSync(designSrc, join(ROOT, projectPath, "DESIGN.md"));

  return { projectPath, projectDir: join(ROOT, projectPath), designCopied, platform: orientationSpec.platform };
}
