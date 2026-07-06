const { buildWakeDigest } = require("./wake-digest");

class SystemMessageDispatcher {
  constructor({ queueStore, config, accountId, digestBuilder = buildWakeDigest } = {}) {
    this.queueStore = queueStore;
    this.config = config;
    this.accountId = accountId;
    this.digestBuilder = digestBuilder;
    this.lastDispatchAtBySender = new Map();
  }

  hasPending() {
    return this.queueStore.hasPendingForAccount(this.accountId);
  }

  drainPending() {
    return this.queueStore.drainForAccount(this.accountId);
  }

  requeue(message) {
    return this.queueStore.enqueue(message);
  }

  resolveWorkspaceRoot(message) {
    return normalizeText(message?.workspaceRoot) || normalizeText(this.config.workspaceRoot);
  }

  buildPreparedMessage(message, contextToken = "") {
    const nowMs = Date.now();
    const senderId = normalizeText(message?.senderId);
    const sinceMs = senderId ? this.lastDispatchAtBySender.get(senderId) || 0 : 0;
    let digest = "";
    try {
      digest = this.digestBuilder({
        config: this.config,
        senderId,
        sinceMs,
        nowMs,
      }) || "";
    } catch {
      digest = "";
    }
    const prepared = {
      provider: "system",
      workspaceId: this.config.workspaceId,
      accountId: this.accountId,
      chatId: message.senderId,
      threadKey: `system:${message.senderId}`,
      senderId: message.senderId,
      messageId: message.id,
      text: buildSystemInboundText({ text: message?.text, createdAt: message?.createdAt, digest }),
      attachments: [],
      command: "message",
      contextToken,
      receivedAt: normalizeIsoTime(message?.createdAt) || new Date().toISOString(),
      workspaceRoot: this.resolveWorkspaceRoot(message),
    };
    if (senderId) {
      this.lastDispatchAtBySender.set(senderId, nowMs);
    }
    return prepared;
  }
}

function buildSystemInboundText({ text, createdAt = "", digest = "" } = {}) {
  const body = normalizeText(text);
  const localTime = formatSystemLocalTime(createdAt);
  const trimmedDigest = normalizeText(digest);
  const sections = [
    ...(localTime ? [`[${localTime}]`, ""] : []),
    ...(trimmedDigest ? [trimmedDigest, ""] : []),
    "SYSTEM ACTION MODE: internal trigger, not user chat.",
    "Do any timeline/diary/reminder/whereabouts work in this turn.",
    "If you act, end with send_message that briefly and naturally reflects what you did or what changed; use silent only if you do nothing.",
    "Return exactly one JSON object after any tool calls:",
    "{\"action\":\"silent\"}",
    "{\"action\":\"send_message\",\"message\":\"<one short natural WeChat message>\"}",
    "No markdown fences. No reasoning. No text outside the JSON.",
  ];
  if (body) {
    sections.push("", "Trigger:", body);
  }
  return sections.join("\n").trim();
}

function formatSystemLocalTime(value) {
  const normalized = normalizeIsoTime(value);
  if (!normalized) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(normalized)).replace(/\//g, "-");
}

function normalizeIsoTime(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toISOString();
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { SystemMessageDispatcher };
