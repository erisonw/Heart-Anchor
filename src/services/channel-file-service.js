const fs = require("fs");
const path = require("path");

const { resolvePreferredSenderId } = require("../core/default-targets");

class ChannelFileService {
  constructor({ config, channelAdapter, sessionStore, voiceTranscoder = null }) {
    this.config = config;
    this.channelAdapter = channelAdapter;
    this.sessionStore = sessionStore;
    this.voiceTranscoder = voiceTranscoder;
  }

  async sendToCurrentChat({ filePath = "", userId = "" } = {}, context = {}) {
    const delivery = this.resolveDelivery({ filePath, userId, context, label: "file" });

    await this.channelAdapter.sendTyping({
      userId: delivery.userId,
      status: 1,
      contextToken: delivery.contextToken,
    }).catch(() => {});
    await this.channelAdapter.sendFile({
      userId: delivery.userId,
      filePath: delivery.filePath,
      contextToken: delivery.contextToken,
    });
    await this.channelAdapter.sendTyping({
      userId: delivery.userId,
      status: 0,
      contextToken: delivery.contextToken,
    }).catch(() => {});
    return { userId: delivery.userId, filePath: delivery.filePath };
  }

  async sendVoiceToCurrentChat({
    filePath = "",
    userId = "",
    playtimeMs,
    text = "",
    sampleRate,
    bitsPerSample,
    outputFormat,
    deliveryMode,
  } = {}, context = {}) {
    const delivery = this.resolveDelivery({ filePath, userId, context, label: "voice file" });
    const normalizedPlaytimeMs = normalizePositiveInteger(playtimeMs);
    if (!normalizedPlaytimeMs) {
      throw new Error("Voice playtimeMs must be an integer greater than 0.");
    }
    const requestedDeliveryMode = normalizeRequestedDeliveryMode(
      deliveryMode || this.config.ttsDeliveryMode || "audio"
    );
    const channelId = normalizeText(this.channelAdapter.describe?.()?.id).toLowerCase();
    const normalizedDeliveryMode = resolveDeliveryMode({
      requestedDeliveryMode,
      channelId,
      playtimeMs: normalizedPlaytimeMs,
      maxVoiceSeconds: this.config.ttsVoiceMaxSeconds,
    });
    const preparedVoice = await this.prepareVoiceFile({
      filePath: delivery.filePath,
      playtimeMs: normalizedPlaytimeMs,
      sampleRate,
      bitsPerSample,
      outputFormat,
      deliveryMode: normalizedDeliveryMode,
    });

    await this.channelAdapter.sendTyping({
      userId: delivery.userId,
      status: 1,
      contextToken: delivery.contextToken,
    }).catch(() => {});
    const result = await this.channelAdapter.sendVoice({
      userId: delivery.userId,
      filePath: preparedVoice.filePath,
      contextToken: delivery.contextToken,
      playtimeMs: preparedVoice.playtimeMs || normalizedPlaytimeMs,
      text,
      sampleRate: preparedVoice.sampleRate || sampleRate,
      bitsPerSample: preparedVoice.bitsPerSample || bitsPerSample,
      deliveryMode: normalizedDeliveryMode,
    });
    await this.channelAdapter.sendTyping({
      userId: delivery.userId,
      status: 0,
      contextToken: delivery.contextToken,
    }).catch(() => {});
    return {
      userId: delivery.userId,
      filePath: preparedVoice.filePath,
      sourceFilePath: delivery.filePath,
      playtimeMs: preparedVoice.playtimeMs || normalizedPlaytimeMs,
      text: normalizeText(text),
      convertedVoice: Boolean(preparedVoice.converted),
      deliveryMode: normalizedDeliveryMode,
      delivery: result,
    };
  }

  async prepareVoiceFile({
    filePath,
    playtimeMs,
    sampleRate,
    bitsPerSample,
    outputFormat,
    deliveryMode,
  }) {
    const channelId = normalizeText(this.channelAdapter.describe?.().id).toLowerCase();
    if (channelId === "telegram") {
      if (
        normalizeDeliveryMode(deliveryMode) === "voice"
        && this.voiceTranscoder
        && typeof this.voiceTranscoder.prepareForTelegramVoice === "function"
      ) {
        return this.voiceTranscoder.prepareForTelegramVoice({
          filePath,
          playtimeMs,
          sampleRate,
          bitsPerSample,
          outputFormat,
        });
      }
      return { filePath, playtimeMs, sampleRate, bitsPerSample, converted: false };
    }
    if (!this.voiceTranscoder || typeof this.voiceTranscoder.prepareForWeixinVoice !== "function") {
      return { filePath, playtimeMs, sampleRate, bitsPerSample, converted: false };
    }
    return this.voiceTranscoder.prepareForWeixinVoice({
      filePath,
      playtimeMs,
      sampleRate,
      bitsPerSample,
      outputFormat,
    });
  }

  resolveDelivery({ filePath = "", userId = "", context = {}, label = "file" } = {}) {
    const account = this.channelAdapter.resolveAccount();
    const contextTokens = typeof this.channelAdapter.getKnownContextTokens === "function"
      ? this.channelAdapter.getKnownContextTokens()
      : {};
    const targetUserId = normalizeText(userId)
      || normalizeText(context?.senderId)
      || resolvePreferredSenderId({
        config: this.config,
        accountId: account.accountId,
        sessionStore: this.sessionStore,
      })
      || resolveOnlyKnownContextUserId(contextTokens);
    if (!targetUserId) {
      throw new Error(`Cannot determine which channel user should receive the ${label}.`);
    }

    const contextToken = String(contextTokens[targetUserId] || "").trim();
    if (!contextToken) {
      throw new Error(`Cannot find a context token for user ${targetUserId}. Let this user talk to the bot once first.`);
    }

    const requestedPath = normalizeText(filePath);
    if (!requestedPath) {
      throw new Error(`Missing ${label} path to send.`);
    }
    const resolvedPath = path.resolve(requestedPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File does not exist: ${resolvedPath}`);
    }
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      throw new Error(`Only files can be sent, not directories: ${resolvedPath}`);
    }

    return {
      userId: targetUserId,
      contextToken,
      filePath: resolvedPath,
    };
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeDeliveryMode(value) {
  return normalizeText(value).toLowerCase() === "voice" ? "voice" : "audio";
}

function normalizeRequestedDeliveryMode(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "auto" || normalized === "voice" || normalized === "audio") {
    return normalized;
  }
  return "audio";
}

function resolveDeliveryMode({ requestedDeliveryMode, channelId, playtimeMs, maxVoiceSeconds }) {
  if (requestedDeliveryMode !== "auto") {
    return normalizeDeliveryMode(requestedDeliveryMode);
  }
  if (channelId !== "telegram") {
    return "voice";
  }
  const maxSeconds = normalizePositiveInteger(maxVoiceSeconds) || 60;
  return normalizePositiveInteger(playtimeMs) <= maxSeconds * 1000 ? "voice" : "audio";
}

function resolveOnlyKnownContextUserId(contextTokens) {
  const userIds = Object.keys(contextTokens || {})
    .map((value) => normalizeText(value))
    .filter(Boolean);
  return userIds.length === 1 ? userIds[0] : "";
}

module.exports = { ChannelFileService };
