function formatTokens(n) {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

/** Shows a step's DashScope token usage next to its StatusBadge. Steps without an
 *  LLM call (audio, render) never get a `usage` object, so this renders nothing. */
export function TokenBadge({ usage }) {
  if (!usage?.totalTokens) return null;
  return <span className="token-badge" title={`${usage.promptTokens} prompt + ${usage.completionTokens} completion`}>{formatTokens(usage.totalTokens)} token</span>;
}
