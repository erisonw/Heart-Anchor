const { formatCompactNumber } = require("./values");

function formatContextStatusLine({ runtimeName, context, claudeContextWindow, claudeMaxOutputTokens }) {
  if (runtimeName === "claudecode") {
    const configuredWindow = Number(claudeContextWindow);
    if (!Number.isFinite(configuredWindow) || configuredWindow <= 0) {
      return "📦 context: set CYBERBOSS_CLAUDE_CONTEXT_WINDOW";
    }
    const reservedOutputTokens = Math.max(0, Number(claudeMaxOutputTokens) || 0);
    const availableMessageWindow = configuredWindow - reservedOutputTokens;
    if (availableMessageWindow <= 0) {
      return "📦 context: reduce CLAUDE_CODE_MAX_OUTPUT_TOKENS";
    }
    if (!context || !Number.isFinite(Number(context.currentTokens))) {
      return "📦 context: unavailable";
    }
    const summary = formatContextUsage(Number(context.currentTokens), availableMessageWindow);
    const cacheSummary = formatClaudeCacheUsage(context);
    const parts = [`📦 context: approx ${summary}`];
    if (reservedOutputTokens > 0) {
      parts.push(`reserve ${formatCompactNumber(reservedOutputTokens)}`);
    }
    if (cacheSummary) {
      parts.push(cacheSummary);
    }
    return parts.join(" | ");
  }
  if (!context) {
    return "📦 context: unavailable";
  }
  const currentTokens = Number(context.currentTokens);
  const contextWindow = Number(context.contextWindow);
  if (!Number.isFinite(currentTokens) || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return "📦 context: unavailable";
  }
  return `📦 context: ${formatContextUsage(currentTokens, contextWindow)}`;
}

function formatClaudeCacheUsage(context) {
  const inputTokens = normalizeNonNegativeNumber(context?.inputTokens);
  const cacheCreationTokens = normalizeNonNegativeNumber(context?.cacheCreationInputTokens);
  const cacheReadTokens = normalizeNonNegativeNumber(context?.cacheReadInputTokens);
  const totalPromptTokens = inputTokens + cacheCreationTokens + cacheReadTokens;
  if (totalPromptTokens <= 0) {
    return "";
  }
  const hitPercent = Math.max(0, Math.min(100, Math.round((cacheReadTokens / totalPromptTokens) * 100)));
  return `cache ${hitPercent}% hit (${formatCompactNumber(cacheReadTokens)} read/${formatCompactNumber(cacheCreationTokens)} write)`;
}

function normalizeNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatContextUsage(currentTokens, contextWindow) {
  const safeCurrent = Math.max(0, Number(currentTokens) || 0);
  const safeWindow = Math.max(1, Number(contextWindow) || 1);
  const clampedCurrent = Math.min(safeCurrent, safeWindow);
  const leftPercent = Math.max(0, Math.min(100, Math.round(((safeWindow - clampedCurrent) / safeWindow) * 100)));
  return `${formatCompactNumber(clampedCurrent)}/${formatCompactNumber(safeWindow)} | ${leftPercent}% left`;
}

module.exports = { formatContextStatusLine, formatContextUsage, formatClaudeCacheUsage };
