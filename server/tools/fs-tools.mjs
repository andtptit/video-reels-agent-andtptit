/**
 * Sandboxed read_file/write_file/list_dir tool definitions + executors for the
 * agent loop. Every path is resolved against `projectDir` and rejected if it would
 * escape that root (e.g. "../../etc/passwd") — the model only ever gets to touch
 * files inside the one project it was invoked for.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { resolve, relative, dirname, isAbsolute } from "path";

function resolveSafe(root, relPath) {
  const abs = resolve(root, relPath);
  const rel = relative(root, abs);
  const escapes = rel === ".." || rel.startsWith(`..${"/"}`) || rel.startsWith("..\\") || isAbsolute(rel);
  if (escapes) throw new Error(`Path escapes project directory: ${relPath}`);
  return abs;
}

export function createFsTools(projectDir) {
  const root = resolve(projectDir);
  mkdirSync(root, { recursive: true });

  const definitions = [
    {
      type: "function",
      function: {
        name: "write_file",
        description: "Write a file inside the project directory. Creates parent directories as needed. Overwrites if it already exists.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path relative to the project root, e.g. scenes.json or compositions/scene_01.html" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file inside the project directory.",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_dir",
        description: "List entries in a directory inside the project. Defaults to the project root.",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
        },
      },
    },
  ];

  const executors = {
    write_file: ({ path, content }) => {
      const abs = resolveSafe(root, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf-8");
      return { ok: true, path, bytesWritten: Buffer.byteLength(content, "utf-8") };
    },
    read_file: ({ path }) => {
      const abs = resolveSafe(root, path);
      if (!existsSync(abs)) return { ok: false, error: `File not found: ${path}` };
      return { ok: true, path, content: readFileSync(abs, "utf-8") };
    },
    list_dir: ({ path = "." } = {}) => {
      const abs = resolveSafe(root, path);
      if (!existsSync(abs)) return { ok: false, error: `Directory not found: ${path}` };
      return { ok: true, path, entries: readdirSync(abs) };
    },
  };

  return { definitions, executors };
}
