/**
 * Plain-code checks that don't need an LLM turn — cheap to run after each agent
 * task, catch classes of error the agents have actually produced in testing
 * (see plan.md "Việc nhỏ nên làm khi quay lại"):
 *
 * 1. checkDurationSum — content-planner's `total_estimated_duration` / video-planner's
 *    `total_duration` drifting from the real sum of per-scene durations. The skills
 *    call the total field "chỉ để tham khảo", so this is a warning, not a hard error.
 * 2. checkPseudoElementAnimations — GSAP silently no-ops on `gsap.to("#id::after", ...)`
 *    style selectors (no crash, no lint finding — confirmed live in scene-writer
 *    testing). Regex-level static check, not a full CSS/JS parse.
 * 3. checkCanvasDimensions — a scene's root element must declare the project's actual
 *    `data-width`/`data-height`. hyperframes lint checks each composition file in
 *    isolation, so it can't catch two scenes disagreeing with each other on canvas
 *    size — confirmed live: a scene authored at 1080x1920 wired into a project
 *    everywhere else 1920x1080 rendered with its content squeezed into a fraction of
 *    the frame, no lint error, no crash.
 */

export function checkDurationSum({ total, scenes, key, toleranceSeconds = 1 }) {
  const sum = scenes.reduce((s, scene) => s + (Number(scene[key]) || 0), 0);
  const diff = Math.round((total - sum) * 100) / 100;
  return { ok: Math.abs(diff) <= toleranceSeconds, total, sum, diff };
}

// Matches gsap.to(...) and any timeline var (tl.to(...), timeline.from(...), etc.) —
// the real bug caught in scene-writer testing was `tl.to("#scene-01::after", ...)`,
// not a direct `gsap.` call, so the method receiver must stay a wildcard.
const PSEUDO_GSAP_RE = /\b\w+\.(to|from|fromTo|set)\(\s*(["'`])([^"'`]*?)::(before|after)([^"'`]*?)\2/g;

export function checkPseudoElementAnimations(html) {
  const findings = [];
  for (const match of html.matchAll(PSEUDO_GSAP_RE)) {
    const [full, method, , selectorHead, pseudo] = match;
    findings.push({
      code: "pseudo-element-animation",
      message: `.${method}() nhắm vào selector "${selectorHead}::${pseudo}" — GSAP không animate được pseudo-element qua cách này, hiệu ứng sẽ âm thầm không chạy (không crash, không lỗi lint).`,
      match: full,
    });
  }
  return findings;
}

export function checkCanvasDimensions(html, expectedWidth, expectedHeight) {
  const widthMatch = html.match(/data-width="(\d+)"/);
  const heightMatch = html.match(/data-height="(\d+)"/);
  const actualWidth = widthMatch ? Number(widthMatch[1]) : null;
  const actualHeight = heightMatch ? Number(heightMatch[1]) : null;
  if (actualWidth === expectedWidth && actualHeight === expectedHeight) return [];
  return [
    {
      code: "canvas-dimension-mismatch",
      message: `Composition khai báo data-width/data-height = ${actualWidth}x${actualHeight}, nhưng project này dùng ${expectedWidth}x${expectedHeight} — scene sẽ bị lệch/tràn khi ghép vào root.`,
    },
  ];
}

// Root composer's index.html declares data-width/data-height MULTIPLE times — once
// on the root <div>, once per scene host <div data-composition-src=...> — and every
// one of them must agree with the project's format. checkCanvasDimensions() above
// only inspects the FIRST occurrence (correct for a single-composition scene file,
// wrong here). Confirmed live: root-composer had no format/dimension guidance at
// all and wrote every data-width/data-height as 1920x1080 for a 9:16 project — the
// root matched what would've been the first-match check, but every scene host did
// too, and each scene's own 1080x1920 sub-composition got squeezed into that
// landscape host, producing the exact "content bunched in a corner, text
// overlapping" render the user reported. Flags EVERY mismatching occurrence, not
// just the first, and reports which attribute+value so the fix-retry prompt can
// point at the literal wrong numbers instead of a vague "dimensions are wrong".
export function checkAllCanvasDimensions(html, expectedWidth, expectedHeight) {
  const findings = [];
  for (const match of html.matchAll(/data-width="(\d+)"/g)) {
    const actual = Number(match[1]);
    if (actual !== expectedWidth) {
      findings.push({
        code: "canvas-dimension-mismatch",
        message: `Tìm thấy data-width="${actual}" nhưng project này dùng ${expectedWidth}x${expectedHeight} — sửa MỌI data-width/data-height (root lẫn từng scene host) về đúng số này.`,
      });
    }
  }
  for (const match of html.matchAll(/data-height="(\d+)"/g)) {
    const actual = Number(match[1]);
    if (actual !== expectedHeight) {
      findings.push({
        code: "canvas-dimension-mismatch",
        message: `Tìm thấy data-height="${actual}" nhưng project này dùng ${expectedWidth}x${expectedHeight} — sửa MỌI data-width/data-height (root lẫn từng scene host) về đúng số này.`,
      });
    }
  }
  return findings;
}

// Root cause of the "content bunched in the top corner, text overlapping" bug the
// user reported on every scene of a real project. Bisected by hand: took the exact
// broken index.html + scene_01.html into an isolated scratch project, confirmed
// scene_01.html alone rendered PERFECTLY (proving the scene file was never the
// problem), then re-added the real root's <style> block piece by piece. Removing
// just this one rule — `.clip { position: absolute; width: 100%; height: 100%; ... }`,
// which root-composer had invented on its own — fixed the render with zero other
// changes. `class="clip"` is a framework-owned marker for timed-visibility control
// (see hyperframes-core skill); authoring CSS for it, especially `position`, fights
// however the framework mounts/sizes the scene-host element and collapses the
// sub-composition's content to an auto-height box pinned near the top instead of
// filling the intended canvas. hyperframes lint never flags this — it's valid CSS,
// just wrong for this framework's contract.
const CLIP_OVERRIDE_RE = /\.clip(?:[.\w-]*)\s*\{[^}]*\bposition\s*:\s*absolute[^}]*\}/gi;

export function checkClipClassOverride(html) {
  const findings = [];
  for (const match of html.matchAll(CLIP_OVERRIDE_RE)) {
    findings.push({
      code: "clip-class-override",
      message: `Composition tự định nghĩa CSS cho ".clip" có position:absolute — class "clip" do framework tự quản lý (visibility theo thời gian), KHÔNG được tự viết CSS cho nó (nhất là position). Xoá hẳn rule này; nếu cần định vị/kích thước, đặt trên class/id riêng của bạn, không phải trên ".clip".`,
      match: match[0].slice(0, 160),
    });
  }
  return findings;
}
