function formatTokens(n) {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

/** Shows a step's DashScope token usage + API call count next to its StatusBadge.
 *  Steps without an LLM call (audio, render) never get a `usage` object, so this
 *  renders nothing. Call count matters on its own, separate from token totals — a
 *  step that looped calling write_file many times without stopping (real incident:
 *  6 calls, 184k tokens, on a scene that was already done after the 1st call) shows
 *  up here as an unusually high call count even before you look at the token side. */
export function TokenBadge({ usage }) {
  if (!usage?.totalTokens) return null;
  return (
    <span className="token-badge" title={`${usage.promptTokens} prompt + ${usage.completionTokens} completion`}>
      {formatTokens(usage.totalTokens)} token · {usage.apiCalls ?? "?"} call
    </span>
  );
}
