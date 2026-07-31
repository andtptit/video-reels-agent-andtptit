/**
 * Thin wrapper around the hyperframes CLI (it's CLI-only — `npm view hyperframes bin`
 * only exposes bin/hyperframes.mjs, no importable JS API) so the agent backend can
 * call lint/validate/render as structured calls instead of shelling out ad-hoc and
 * parsing terminal text.
 *
 * Confirmed shapes (hyperframes@0.6.12, via --json):
 *   lint     → { ok, errorCount, warningCount, infoCount, findings: [{code, severity, message, fixHint}], filesScanned }
 *   validate → { ok, errors: [{level, text, url}], warnings: [...], contrastFailures }
 * Both processes exit 1 when ok === false, 0 when ok === true — don't rely on the
 * exit code alone since it's the same signal already carried by `ok` in the JSON.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";

const execFileAsync = promisify(execFile);

const SKIP_DIRS = new Set(["node_modules", ".git", ".hyperframes"]);

/**
 * macOS AppleDouble sidecar files ("._filename") get created next to every write
 * on filesystems without native xattr support (seen live on an external volume in
 * this workspace — see plan.md). `hyperframes lint` scans them as if they were real
 * composition HTML files, producing bogus findings like `root_missing_composition_id`
 * for a file that isn't actually a composition. Sweep them out of the project dir
 * before every lint/validate call so results always reflect the real files.
 */
function cleanAppleDouble(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith("._")) {
      rmSync(join(dir, entry.name), { force: true });
      continue;
    }
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      cleanAppleDouble(join(dir, entry.name));
    }
  }
}

const HYPERFRAMES_VERSION = process.env.HYPERFRAMES_VERSION || "0.6.12";
const BIN = `hyperframes@${HYPERFRAMES_VERSION}`;
const IS_WIN = process.platform === "win32";

// Windows npm shims (npx) are .cmd files — execFile can't spawn them directly
// (EINVAL) since batch scripts need cmd.exe to interpret them. `shell: true` is the
// usual workaround, but it resolves cmd.exe via %ComSpec%/PATH, and some shells
// (Git Bash sessions observed here) don't export ComSpec or a Windows-style PATH,
// so `shell: true` fails with ENOENT. Locating cmd.exe ourselves and invoking it
// as `cmd.exe /d /s /c npx --yes ...` sidesteps both problems, and since every arg
// is a static literal (version pin, subcommand, flags — cwd is never interpolated
// into the command line), this carries no injection risk despite going through cmd.exe.
function resolveCmdExe() {
  const candidates = [
    process.env.ComSpec,
    process.env.SystemRoot && `${process.env.SystemRoot}\\System32\\cmd.exe`,
    process.env.windir && `${process.env.windir}\\System32\\cmd.exe`,
    "C:\\Windows\\System32\\cmd.exe",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? "cmd.exe";
}
const CMD_EXE = IS_WIN ? resolveCmdExe() : null;

async function execHyperframes(args, options) {
  if (IS_WIN) {
    return execFileAsync(CMD_EXE, ["/d", "/s", "/c", "npx", "--yes", BIN, ...args], options);
  }
  return execFileAsync("npx", ["--yes", BIN, ...args], options);
}

async function runJsonCommand(args, cwd) {
  try {
    const { stdout } = await execHyperframes(args, { cwd, maxBuffer: 1024 * 1024 * 10 });
    return JSON.parse(stdout);
  } catch (err) {
    // hyperframes exits 1 on lint/validate failure — stdout still has the JSON report
    if (err.stdout) {
      try { return JSON.parse(err.stdout); } catch { /* fall through */ }
    }
    throw new Error(`hyperframes ${args[0]} failed to run: ${err.message}`);
  }
}

/** @returns {Promise<{ok: boolean, errorCount: number, warningCount: number, findings: object[]}>} */
export function lint(projectDir) {
  cleanAppleDouble(projectDir);
  return runJsonCommand(["lint", "--json"], projectDir);
}

/** @returns {Promise<{ok: boolean, errors: object[], warnings: object[]}>} */
export function validate(projectDir, { contrast = false } = {}) {
  cleanAppleDouble(projectDir);
  const args = ["validate", "--json"];
  if (!contrast) args.push("--no-contrast");
  return runJsonCommand(args, projectDir);
}

/** Render doesn't support --json; resolve/reject on process exit and surface stderr on failure. */
export async function render(projectDir) {
  try {
    const { stdout } = await execHyperframes(["render"], { cwd: projectDir, maxBuffer: 1024 * 1024 * 50 });
    return { ok: true, output: stdout };
  } catch (err) {
    return { ok: false, output: err.stdout, error: err.stderr ?? err.message };
  }
}
