const fs = require("fs");
const path = require("path");

const { telegramPostForm, telegramPostJson } = require("./api");
const {
  chunkReplyTextForWeixin: chunkReplyTextByNaturalBoundaries,
  packChunksForWeixinDelivery: packChunksForDelivery,
  trimOuterBlankLines,
} = require("../weixin");
const { loadSyncBuffer, saveSyncBuffer } = require("../weixin/sync-buffer-store");

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_SEND_TIMEOUT_MS = 30_000;
const TELEGRAM_MESSAGE_TEXT_LIMIT = 4096;
const DEFAULT_MIN_TELEGRAM_CHUNK_CHARS = 1;
const TELEGRAM_MAX_DELIVERY_MESSAGES = 20;

function createTelegramChannelAdapter(config) {
  const token = normalizeText(config?.telegramBotToken);
  const accountId = `telegram:${resolveBotId(token) || "bot"}`;
  const baseUrl = normalizeText(config?.telegramApiBaseUrl) || "https://api.telegram.org";
  const transport = normalizeText(config?.telegramTransport).toLowerCase();
  let minTelegramChunkChars = normalizeMinChunkChars(config?.telegramMinChunkChars);
  const allowedChatIds = new Set(
    Array.isArray(config?.telegramAllowedChatIds)
      ? config.telegramAllowedChatIds.map(normalizeChatId).filter(Boolean)
      : []
  );
  const contextTokens = Object.fromEntries(
    Array.from(allowedChatIds).map((chatId) => [chatId, `tg:${chatId}`])
  );

  function ensureToken() {
    if (!token) {
      throw new Error("CYBERBOSS_TELEGRAM_BOT_TOKEN is required for Telegram channel.");
    }
  }

  function rememberChat(chatId) {
    const normalizedChatId = normalizeChatId(chatId);
    if (!normalizedChatId) {
      return "";
    }
    const contextToken = `tg:${normalizedChatId}`;
    contextTokens[normalizedChatId] = contextToken;
    return contextToken;
  }

  return {
    describe() {
      return {
        id: "telegram",
        kind: "channel",
        stateDir: config.stateDir,
        baseUrl,
        accountId,
      };
    },
    async login() {
      ensureToken();
      console.log("Telegram channel uses CYBERBOSS_TELEGRAM_BOT_TOKEN; send /start to the bot before starting Cyberboss.");
    },
    printAccounts() {
      console.log("Telegram account:");
      console.log(`- ${accountId}`);
      console.log(`  baseUrl: ${baseUrl}`);
      console.log(`  allowedChats: ${allowedChatIds.size ? Array.from(allowedChatIds).join(",") : "(any)"}`);
    },
    resolveAccount() {
      ensureToken();
      return {
        accountId,
        userId: accountId,
        baseUrl,
        token,
      };
    },
    getKnownContextTokens() {
      return { ...contextTokens };
    },
    loadSyncBuffer() {
      return loadSyncBuffer(config, accountId);
    },
    saveSyncBuffer(buffer) {
      saveSyncBuffer(config, accountId, String(buffer || ""));
    },
    async getUpdates({ syncBuffer = "", timeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS } = {}) {
      ensureToken();
      const offset = parsePositiveInteger(syncBuffer);
      const pollTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
      const telegramTimeoutSeconds = Math.max(0, Math.floor(pollTimeoutMs / 1000));
      const body = {
        timeout: telegramTimeoutSeconds,
        allowed_updates: ["message"],
      };
      if (offset > 0) {
        body.offset = offset;
      }
      const response = await telegramPostJson({
        baseUrl,
        token,
        method: "getUpdates",
        body,
        timeoutMs,
        transport,
      });
      const updates = Array.isArray(response?.result) ? response.result : [];
      if (updates.length === 0 && telegramTimeoutSeconds === 0 && pollTimeoutMs > 0) {
        await sleep(pollTimeoutMs);
      }
      const nextOffset = updates.reduce((max, update) => {
        const updateId = parsePositiveInteger(update?.update_id);
        return updateId > max ? updateId : max;
      }, 0);
      const newBuffer = nextOffset > 0 ? String(nextOffset + 1) : String(syncBuffer || "");
      if (newBuffer && newBuffer !== String(syncBuffer || "")) {
        this.saveSyncBuffer(newBuffer);
      }
      for (const update of updates) {
        const chatId = normalizeChatId(update?.message?.chat?.id);
        if (chatId) {
          rememberChat(chatId);
        }
      }
      return {
        ret: 0,
        msgs: updates,
        get_updates_buf: newBuffer,
      };
    },
    normalizeIncomingMessage(update) {
      const message = update?.message && typeof update.message === "object" ? update.message : null;
      if (!message) {
        return null;
      }
      const chatId = normalizeChatId(message?.chat?.id);
      if (!chatId || (allowedChatIds.size && !allowedChatIds.has(chatId))) {
        return null;
      }
      const text = normalizeText(message.text || message.caption);
      const attachments = normalizeAttachments(message);
      if (!text && !attachments.length) {
        return null;
      }
      const contextToken = rememberChat(chatId);
      return {
        provider: "telegram",
        accountId,
        workspaceId: config.workspaceId,
        senderId: chatId,
        chatId,
        messageId: normalizeText(message.message_id),
        threadKey: chatId,
        text,
        attachments,
        contextToken,
        receivedAt: message.date ? new Date(Number(message.date) * 1000).toISOString() : new Date().toISOString(),
      };
    },
    async sendText({ userId, text, preserveBlock = false }) {
      ensureToken();
      const chatId = requireChatId(userId);
      const chunks = splitTelegramText(text, {
        preserveBlock,
        minChunkChars: minTelegramChunkChars,
      });
      for (const chunk of chunks) {
        await telegramPostJson({
          baseUrl,
          token,
          method: "sendMessage",
          body: {
            chat_id: chatId,
            text: chunk,
            disable_web_page_preview: true,
          },
          timeoutMs: DEFAULT_SEND_TIMEOUT_MS,
          transport,
        });
      }
    },
    async sendTyping({ userId, status = 1 }) {
      ensureToken();
      if (!status) {
        return;
      }
      await telegramPostJson({
        baseUrl,
        token,
        method: "sendChatAction",
        body: {
          chat_id: requireChatId(userId),
          action: "typing",
        },
        timeoutMs: 10_000,
        transport,
      });
    },
    async sendFile({ userId, filePath }) {
      ensureToken();
      const resolvedPath = assertFile(filePath);
      const form = await createFileForm({
        chatId: requireChatId(userId),
        fieldName: "document",
        filePath: resolvedPath,
      });
      await telegramPostForm({
        baseUrl,
        token,
        method: "sendDocument",
        form,
        timeoutMs: DEFAULT_SEND_TIMEOUT_MS,
      });
      return { kind: "file", fileName: path.basename(resolvedPath) };
    },
    async sendVoice({ userId, filePath, playtimeMs, deliveryMode = "audio" }) {
      ensureToken();
      const resolvedPath = assertFile(filePath);
      const asVoiceBubble = normalizeDeliveryMode(deliveryMode) === "voice";
      const form = await createFileForm({
        chatId: requireChatId(userId),
        fieldName: asVoiceBubble ? "voice" : "audio",
        filePath: resolvedPath,
      });
      const duration = Math.max(1, Math.round((parsePositiveInteger(playtimeMs) || 1000) / 1000));
      form.set("duration", String(duration));
      await telegramPostForm({
        baseUrl,
        token,
        method: asVoiceBubble ? "sendVoice" : "sendAudio",
        form,
        timeoutMs: DEFAULT_SEND_TIMEOUT_MS,
      });
      return { kind: asVoiceBubble ? "voice" : "audio", fileName: path.basename(resolvedPath) };
    },
    setMinChunkChars(value) {
      minTelegramChunkChars = normalizeMinChunkChars(value);
      return minTelegramChunkChars;
    },
    getMinChunkChars() {
      return minTelegramChunkChars;
    },
  };
}

function normalizeAttachments(message) {
  const attachments = [];
  if (message.photo) {
    const photos = Array.isArray(message.photo) ? message.photo : [];
    const photo = photos[photos.length - 1];
    if (photo?.file_id) {
      attachments.push({
        kind: "image",
        fileName: "",
        sizeBytes: parsePositiveInteger(photo.file_size),
        directUrls: [],
        mediaRef: { fileId: normalizeText(photo.file_id) },
      });
    }
  }
  for (const [kind, payload] of [
    ["file", message.document],
    ["audio", message.audio],
    ["voice", message.voice],
    ["video", message.video],
  ]) {
    if (!payload?.file_id) {
      continue;
    }
    attachments.push({
      kind,
      fileName: normalizeText(payload.file_name),
      sizeBytes: parsePositiveInteger(payload.file_size),
      directUrls: [],
      mediaRef: { fileId: normalizeText(payload.file_id) },
    });
  }
  return attachments;
}

async function createFileForm({ chatId, fieldName, filePath }) {
  const buf = await fs.promises.readFile(filePath);
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set(fieldName, new Blob([buf]), path.basename(filePath));
  return form;
}

function splitTelegramText(text, { preserveBlock = false, minChunkChars = DEFAULT_MIN_TELEGRAM_CHUNK_CHARS } = {}) {
  const normalized = trimOuterBlankLines(String(text || "")) || "Completed.";
  if (!preserveBlock) {
    const naturalChunks = chunkReplyTextByNaturalBoundaries(normalized, minChunkChars)
      .map((chunk) => trimOuterBlankLines(chunk))
      .filter(Boolean);
    return packChunksForDelivery(
      naturalChunks.length ? naturalChunks : [normalized],
      TELEGRAM_MAX_DELIVERY_MESSAGES,
      TELEGRAM_MESSAGE_TEXT_LIMIT
    ).flatMap((chunk) => splitTelegramTextHard(chunk));
  }
  return splitTelegramTextHard(normalized);
}

function splitTelegramTextHard(text) {
  const normalized = String(text || "").trim() || "Completed.";
  const chunks = [];
  let rest = normalized;
  while (rest.length > TELEGRAM_MESSAGE_TEXT_LIMIT) {
    chunks.push(rest.slice(0, TELEGRAM_MESSAGE_TEXT_LIMIT));
    rest = rest.slice(TELEGRAM_MESSAGE_TEXT_LIMIT);
  }
  chunks.push(rest);
  return chunks;
}

function assertFile(filePath) {
  const resolvedPath = path.resolve(normalizeText(filePath));
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    throw new Error(`File does not exist: ${resolvedPath || "(empty)"}`);
  }
  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    throw new Error(`Only files can be sent, not directories: ${resolvedPath}`);
  }
  return resolvedPath;
}

function requireChatId(value) {
  const chatId = normalizeChatId(value);
  if (!chatId) {
    throw new Error("Telegram chat id is required.");
  }
  return chatId;
}

function resolveBotId(token) {
  const [botId] = normalizeText(token).split(":");
  return normalizeText(botId);
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeChatId(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function normalizeText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function normalizeDeliveryMode(value) {
  return normalizeText(value).toLowerCase() === "voice" ? "voice" : "audio";
}

function normalizeMinChunkChars(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_TELEGRAM_CHUNK_CHARS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

module.exports = { createTelegramChannelAdapter };
