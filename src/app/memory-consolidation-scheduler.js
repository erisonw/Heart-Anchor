const crypto = require("crypto");

const { createChannelAdapter } = require("../adapters/channel");
const { SessionStore } = require("../adapters/runtime/codex/session-store");
const { resolvePreferredSenderId, resolvePreferredWorkspaceRoot } = require("../core/default-targets");
const { SystemMessageQueueStore } = require("../core/system-message-queue-store");
const {
  buildConsolidationTrigger,
  writeConsolidationStatus,
} = require("../services/memory-consolidation-prompt");

const DEFAULT_TIME = "03:30";
const TIME_ZONE = "Asia/Shanghai";

// 每天在配置时刻把"记忆整理"触发体丢进 system queue，由 agent 静默执行。
async function runMemoryConsolidationScheduler({ config, memoryService }) {
  if (!memoryService) {
    throw new Error("memory consolidation requires the memory service");
  }
  const account = createChannelAdapter(config).resolveAccount();
  const queue = new SystemMessageQueueStore({ filePath: config.systemMessageQueueFile });
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  const senderId = resolvePreferredSenderId({ config, accountId: account.accountId, sessionStore });
  const workspaceRoot = resolvePreferredWorkspaceRoot({
    config,
    accountId: account.accountId,
    senderId,
    sessionStore,
  });
  if (!senderId || !workspaceRoot) {
    throw new Error("Cannot determine the target user/workspace for memory consolidation.");
  }
  const time = normalizeTime(config.memoryConsolidationTime);
  console.log(`[heart-anchor] memory consolidation scheduler ready time=${time} user=${senderId}`);

  while (true) {
    const delayMs = computeNextRunMs(Date.now(), time, TIME_ZONE);
    console.log(`[heart-anchor] next memory consolidation in ${Math.round(delayMs / 60000)}m`);
    await sleep(delayMs);

    const expired = memoryService.expireStaleCandidates();
    if (expired.length) {
      console.log(`[heart-anchor] memory consolidation expired ${expired.length} stale candidate(s)`);
    }
    if (queue.hasPendingForAccount(account.accountId)) {
      console.log("[heart-anchor] memory consolidation skipped: pending system message still in queue");
      continue;
    }
    const queued = queue.enqueue({
      id: crypto.randomUUID(),
      accountId: account.accountId,
      senderId,
      workspaceRoot,
      text: buildConsolidationTrigger({ config, memoryService }),
      createdAt: new Date().toISOString(),
    });
    writeConsolidationStatus(config, {
      lastQueuedAt: new Date().toISOString(),
      lastQueueId: queued.id,
      source: "scheduler",
    });
    console.log(`[heart-anchor] memory consolidation queued id=${queued.id}`);
  }
}

// 距离下一次 timeZone 本地时刻 HH:mm 的毫秒数。
function computeNextRunMs(nowMs, time, timeZone = TIME_ZONE) {
  const { hours, minutes } = parseTime(time);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const get = (type) => Number(parts.find((part) => part.type === type)?.value) || 0;
  const currentSeconds = (get("hour") % 24) * 3600 + get("minute") * 60 + get("second");
  const targetSeconds = hours * 3600 + minutes * 60;
  let deltaSeconds = targetSeconds - currentSeconds;
  if (deltaSeconds <= 0) {
    deltaSeconds += 86_400;
  }
  return deltaSeconds * 1000;
}

function parseTime(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || "").trim());
  if (!match) {
    return parseTime(DEFAULT_TIME);
  }
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function normalizeTime(value) {
  const { hours, minutes } = parseTime(value);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { runMemoryConsolidationScheduler, computeNextRunMs, parseTime };
