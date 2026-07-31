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
