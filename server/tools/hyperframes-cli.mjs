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
import { CancelledError } from "../jobs/cancel-registry.mjs";

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

// No prior timeout on this call meant a hung `hyperframes render` child process
// (or one orphaned by a server restart — see reconcileInterruptedSteps) would leave
// job-status.json stuck at "running" forever, with no way to recover from the UI.
// 10 minutes is generous for a single short-form video render on this hardware but
// still a hard ceiling — override via env for unusually long/complex projects.
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS) || 10 * 60 * 1000;

/**
 * `--no-experimental-fast-capture` disables hyperframes' default macOS fast-capture
 * path (reads DOM paint records directly instead of Page.captureScreenshot). Found
 * live via a user-reported screenshot: a 2-3 frame flash of raw peach background
 * poking through the bottom caption gradient (`.s?-shade`), always landing inside a
 * caption chunk's visible window (i.e. right after a DOM mutation from HyperFrames'
 * clip-visibility toggle) — a paint-record read racing an in-flight reflow. Confirmed
 * via ffmpeg per-frame pixel sampling: the fast-capture render showed 1/287 bad
 * frames; disabling it and re-rendering the same scene showed 0/287. Non-deterministic
 * (a same-settings retry can also come back clean), so this is a mitigation for a race
 * condition, not a proven root-cause fix — revert if it turns out to cost too much
 * render time and the artifact stays rare enough to ignore.
 */
const RENDER_ARGS = ["render", "--no-experimental-fast-capture"];

/** Render doesn't support --json; resolve/reject on process exit and surface stderr on failure. */
export async function render(projectDir, { signal } = {}) {
  try {
    const { stdout } = await execHyperframes(RENDER_ARGS, {
      cwd: projectDir,
      maxBuffer: 1024 * 1024 * 50,
      timeout: RENDER_TIMEOUT_MS,
      signal, // Node's execFile kills the child (default SIGTERM) when this fires —
      // on Windows the direct child is cmd.exe wrapping npx wrapping hyperframes'
      // own browser-automation workers, so whether this cascades to a fully clean
      // kill of every grandchild process is NOT guaranteed; verify live (see plan.md).
    });
    return { ok: true, output: stdout };
  } catch (err) {
    // A deliberate Huỷ must be reported as CancelledError (thrown, not the normal
    // {ok:false} shape) so runStep records "cancelled" instead of "error" — checked
    // FIRST because an aborted execFile call can also come back looking like a
    // timeout (`err.killed && err.signal`), and that must not be misreported either.
    if (signal?.aborted) throw signal.reason instanceof CancelledError ? signal.reason : new CancelledError();
    const timedOut = err.killed && err.signal;
    return {
      ok: false,
      output: err.stdout,
      error: timedOut ? `Render bị hủy vì quá ${RENDER_TIMEOUT_MS / 1000}s không xong` : (err.stderr ?? err.message),
    };
  }
}
