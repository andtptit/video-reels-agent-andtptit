/**
 * Preview server lifecycle. `hyperframes preview <dir> --background` looked like
 * the right tool per `--help` ("Start an embedded preview that remains running
 * after the command exits"), but confirmed live that `--background` does not exist
 * on the pinned `hyperframes@0.6.12` (added in a later release — 0.7.86 lists it,
 * 0.6.12 silently ignores the unknown flag and runs the normal foreground/interactive
 * `preview` command instead, which never returns). So this module spawns the CLI
 * itself as a detached child process and manages its lifecycle directly, the same
 * way you'd background any long-running dev server — not via a CLI flag.
 */
import { spawn } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import treeKillCb from "tree-kill";

// npx spawns `npx` → `npm exec` → the actual hyperframes binary; on macOS/Linux a
// detached process group covers the whole tree, but Windows has no POSIX process
// groups, so a plain `process.kill(-pid)` would leave the real preview server
// running as an orphan. `tree-kill` walks the process tree on both platforms
// (taskkill /T on Windows, negative-pid signal elsewhere) — same class of
// cross-platform gap that hyperframes-cli.mjs already had to work around for npx.
const treeKill = promisify(treeKillCb);

const HYPERFRAMES_VERSION = process.env.HYPERFRAMES_VERSION || "0.6.12";
const BIN = `hyperframes@${HYPERFRAMES_VERSION}`;
const IDLE_TIMEOUT_MS = Number(process.env.PREVIEW_IDLE_TIMEOUT_MS) || 10 * 60 * 1000;
const BASE_PORT = Number(process.env.PREVIEW_BASE_PORT) || 4100;
const MAX_PORT_SPAN = 200;

/** @type {Map<string, { port: number, pid: number, lastAccess: number, ready: Promise<void> }>} */
const active = new Map();
const usedPorts = new Set();

function allocatePort() {
  for (let p = BASE_PORT; p < BASE_PORT + MAX_PORT_SPAN; p++) {
    if (!usedPorts.has(p)) {
      usedPorts.add(p);
      return p;
    }
  }
  throw new Error("No free preview port available");
}

async function waitUntilListening(port, { retries = 30, delayMs = 500 } = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Preview server on port ${port} did not become ready in time`);
}

/** Starts (or reuses) the preview server for a project, returns its local port. */
export async function ensurePreview(projectDir) {
  const existing = active.get(projectDir);
  if (existing) {
    existing.lastAccess = Date.now();
    await existing.ready;
    return existing.port;
  }
  if (!existsSync(`${projectDir}/index.html`)) {
    throw new Error("No composition found — run `hyperframes init` for this project first");
  }

  const port = allocatePort();
  const child = spawn("npx", ["--yes", BIN, "preview", projectDir, "--port", String(port), "--no-open"], {
    detached: true,
    stdio: "ignore",
    cwd: projectDir,
  });
  child.unref();

  const entry = { port, pid: child.pid, lastAccess: Date.now(), ready: waitUntilListening(port) };
  active.set(projectDir, entry);

  try {
    await entry.ready;
  } catch (err) {
    active.delete(projectDir);
    usedPorts.delete(port);
    await treeKill(child.pid).catch(() => {});
    throw err;
  }
  return port;
}

export function touchPreview(projectDir) {
  const entry = active.get(projectDir);
  if (entry) entry.lastAccess = Date.now();
}

export async function stopPreview(projectDir) {
  const entry = active.get(projectDir);
  if (!entry) return;
  active.delete(projectDir);
  usedPorts.delete(entry.port);
  await treeKill(entry.pid).catch(() => {
    /* already exited */
  });
}

let sweepTimer = null;
export function startIdleSweep(intervalMs = 60_000) {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [projectDir, entry] of active) {
      if (now - entry.lastAccess > IDLE_TIMEOUT_MS) stopPreview(projectDir);
    }
  }, intervalMs);
  sweepTimer.unref?.();
}
