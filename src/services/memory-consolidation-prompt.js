const fs = require("fs");
const path = require("path");

// 夜间记忆整理的触发体。SystemMessageDispatcher 会自动包上 SYSTEM ACTION MODE
// 与 JSON 动作协议；这里只负责整理任务本身的指令与数据内联。
function buildConsolidationTrigger({ config = {}, memoryService, date = "" } = {}) {
  const day = normalizeDate(date) || shanghaiToday();
  const diaryFile = path.join(
    config.diaryDir || path.join(config.stateDir || process.cwd(), "diary"),
    `${day}.md`,
  );
  const candidates = safeCall(() => memoryService.list({ status: "candidate", limit: 20 }), []);
  const pairs = safeCall(() => memoryService.similarPairs({ limit: 8 }), []);

  const candidateLines = candidates.length
    ? candidates.map((memory) =>
        `   - ${memory.id} (age ${ageDays(memory.createdAt)}d, used ${memory.useCount || 0}): ${truncate(memory.content, 120)}`)
    : ["   (none)"];
  const pairLines = pairs.length
    ? pairs.map((pair) =>
        `   - ${pair.left.id} ~ ${pair.right.id} (${pair.score}): "${truncate(pair.left.content, 60)}" / "${truncate(pair.right.content, 60)}"`)
    : ["   (none)"];

  return [
    `MEMORY CONSOLIDATION for ${day} (internal maintenance, not a chat with the user).`,
    "",
    "Review sources:",
    `1. Diary file (may not exist): ${diaryFile}`,
    `2. Timeline: call heart_anchor_timeline_read with date=${day}.`,
    "3. Candidate memories awaiting review:",
    ...candidateLines,
    "4. Near-duplicate memory pairs (precomputed similarity):",
    ...pairLines,
    "",
    "Do:",
    "- Propose durable NEW facts, preferences or relationships found in diary/timeline via heart_anchor_memory_propose (candidates only). Skip one-off events, chit-chat, and anything already covered by existing memories. At most 5 new candidates tonight.",
    "- If the day's sources show slang, memes or fresh expressions the user used that lack a vocab memory, propose them too: type \"vocab\", the term itself as a tag, meaning plus how the user uses it as content. These count toward the 5-candidate budget.",
    "- For each near-duplicate pair above: merge the useful details into the richer memory via heart_anchor_memory_update, then archive the other via heart_anchor_memory_forget.",
    "- If today's information contradicts an existing memory, update it or lower its confidence via heart_anchor_memory_update.",
    "- Do NOT confirm candidate memories; the user reviews them in the web console.",
    "",
    'This is silent maintenance. When finished, output exactly {"action":"silent"}. Only use send_message if something genuinely needs the user\'s attention right now (rare).',
  ].join("\n");
}

function readConsolidationStatus(config = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(config.memoryConsolidationStatusFile, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeConsolidationStatus(config = {}, patch = {}) {
  const filePath = config.memoryConsolidationStatusFile;
  if (!filePath) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ ...readConsolidationStatus(config), ...patch }, null, 2));
  } catch {
    // 状态文件只用于展示，写失败不影响整理本身
  }
}

function normalizeDate(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function shanghaiToday() {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()).replace(/\//g, "-");
}

function ageDays(createdAt) {
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.round((Date.now() - parsed) / 86_400_000));
}

function truncate(value, maxChars) {
  const oneLine = String(value || "").replace(/\s+/g, " ").trim();
  return oneLine.length > maxChars ? `${oneLine.slice(0, maxChars - 1)}…` : oneLine;
}

function safeCall(fn, fallback) {
  try {
    const result = fn();
    return result ?? fallback;
  } catch {
    return fallback;
  }
}

module.exports = { buildConsolidationTrigger, readConsolidationStatus, writeConsolidationStatus };
