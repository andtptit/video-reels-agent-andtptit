/**
 * Local-font support for "sub" style captions — replaces loading fonts live from
 * fonts.googleapis.com at render time.
 *
 * Root cause found live (user report): a rendered video's caption font didn't match
 * what was selected (Mali chosen, rendered frame showed a generic fallback sans).
 * Isolated with Playwright in 2 stages:
 *   1. First suspected the HyperFrames render pipeline not waiting for the Google
 *      Fonts network request — fixed by self-hosting a single "vietnamese subset"
 *      woff2 per weight. Re-rendered: STILL wrong font.
 *   2. Root cause: Google Fonts serves each family/weight as SEVERAL subset files
 *      (latin / latin-ext / vietnamese / ...), each covering a different
 *      `unicode-range` — only grabbing the "vietnamese" subset's file meant the
 *      font had glyphs for Vietnamese-specific diacritic ranges but NONE for plain
 *      ASCII a-z/A-Z (those live in the "latin" subset) — since most characters in
 *      any sentence are plain Latin letters, the whole caption fell back to the
 *      system font per-glyph even though `document.fonts` reported the face as
 *      "loaded" (the file itself loaded fine, it just didn't cover the requested
 *      codepoints). Confirmed by rendering an isolated Mali sample with only the
 *      vietnamese-subset file: plain ASCII text ("Tinh yeu tuoi hoc tro dep") came
 *      out in a generic bold sans, not Mali's rounded handwriting style.
 *
 * Fix: download latin + latin-ext + vietnamese subsets (covers all Vietnamese
 * captions need) per family/weight into the workspace-level `assets/fonts/`
 * library, recorded in `assets/fonts/manifest.json` with each file's real
 * `unicode-range` (copied verbatim from Google's own CSS) — then emit ONE
 * `@font-face` rule per subset file with its matching `unicode-range`, so the
 * browser's normal per-glyph subset-selection picks the right file automatically,
 * exactly like Google's own multi-block CSS does.
 */
import { existsSync, mkdirSync, copyFileSync, readFileSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const FONT_LIBRARY_DIR = join(ROOT, "assets", "fonts");
const MANIFEST = JSON.parse(readFileSync(join(FONT_LIBRARY_DIR, "manifest.json"), "utf-8"));

const DEFAULT_FONT = "Itim";

/** Copies every subset file the given font/weight combo needs from the shared
 *  workspace library into `projectDir/assets/fonts/` — idempotent (skips files
 *  that already exist), same convention as generate-audio.mjs's music/sfx copy. */
export function ensureFontCopied(projectDir, fontFamily) {
  const weights = MANIFEST[fontFamily] ?? MANIFEST[DEFAULT_FONT];
  const destDir = join(projectDir, "assets", "fonts");
  mkdirSync(destDir, { recursive: true });
  const copied = [];
  for (const entries of Object.values(weights)) {
    for (const { file } of entries) {
      const src = join(FONT_LIBRARY_DIR, file);
      const dest = join(destDir, file);
      if (existsSync(src) && !existsSync(dest)) copyFileSync(src, dest);
      copied.push(file);
    }
  }
  return copied;
}

/** Local @font-face CSS for `fontFamily` — one rule per (weight × subset) file,
 *  each with its real `unicode-range` so the browser loads the right file per
 *  glyph, same mechanism Google's own hosted CSS uses. `relativePrefix` lets
 *  callers outside the project root (compositions/*.html, one level deep) point
 *  at "../assets/fonts/..." vs a root-level caller using "assets/fonts/...". */
export function fontFaceCss(fontFamily, relativePrefix = "../assets/fonts") {
  const weights = MANIFEST[fontFamily] ?? MANIFEST[DEFAULT_FONT];
  const blocks = [];
  for (const [weight, entries] of Object.entries(weights)) {
    for (const { file, unicodeRange } of entries) {
      blocks.push(`@font-face {
      font-family: '${fontFamily}';
      font-style: normal;
      font-weight: ${weight};
      font-display: block;
      src: url('${relativePrefix}/${file}') format('woff2');
      unicode-range: ${unicodeRange};
    }`);
    }
  }
  return blocks.join("\n    ");
}
