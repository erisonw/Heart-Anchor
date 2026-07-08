const path = require("path");
const { readEnvRaw, resolveDefaultStateDir } = require("./values");

function readConfig() {
  const argv = process.argv.slice(2);
  const mode = argv[0] || "";
  const stateDir = resolveDefaultStateDir();
  const googleCalendarClientId = readTextEnv("HEART_ANCHOR_GOOGLE_CALENDAR_CLIENT_ID");
  const googleCalendarClientSecret = readTextEnv("HEART_ANCHOR_GOOGLE_CALENDAR_CLIENT_SECRET");
  const googleCalendarRedirectUri = readTextEnv("HEART_ANCHOR_GOOGLE_CALENDAR_REDIRECT_URI");

  return {
    mode,
    argv,
    stateDir,
    workspaceId: readTextEnv("HEART_ANCHOR_WORKSPACE_ID") || "default",
    workspaceRoot: readTextEnv("HEART_ANCHOR_WORKSPACE_ROOT") || process.cwd(),
    userName: readTextEnv("HEART_ANCHOR_USER_NAME") || "User",
    userGender: readTextEnv("HEART_ANCHOR_USER_GENDER") || "female",
    allowedUserIds: readListEnv("HEART_ANCHOR_ALLOWED_USER_IDS"),
    channel: readTextEnv("HEART_ANCHOR_CHANNEL") || "weixin",
    telegramBotToken: readTextEnv("HEART_ANCHOR_TELEGRAM_BOT_TOKEN"),
    telegramAllowedChatIds: readListEnv("HEART_ANCHOR_TELEGRAM_ALLOWED_CHAT_IDS"),
    telegramApiBaseUrl: readTextEnv("HEART_ANCHOR_TELEGRAM_API_BASE_URL") || "https://api.telegram.org",
    telegramPollTimeoutMs: readIntEnv("HEART_ANCHOR_TELEGRAM_POLL_TIMEOUT_MS"),
    telegramTransport: readTextEnv("HEART_ANCHOR_TELEGRAM_TRANSPORT"),
    telegramMinChunkChars: readIntEnv("HEART_ANCHOR_TELEGRAM_MIN_CHUNK_CHARS"),
    telegramVoiceOpusBitrate: readTextEnv("HEART_ANCHOR_TELEGRAM_VOICE_OPUS_BITRATE") || "64k",
    telegramVoiceOpusApplication: readTextEnv("HEART_ANCHOR_TELEGRAM_VOICE_OPUS_APPLICATION") || "audio",
    runtime: readTextEnv("HEART_ANCHOR_RUNTIME") || "codex",
    timelineCommand: readTextEnv("HEART_ANCHOR_TIMELINE_COMMAND") || "timeline-for-agent",
    accountId: readTextEnv("HEART_ANCHOR_ACCOUNT_ID"),
    weixinBaseUrl: readTextEnv("HEART_ANCHOR_WEIXIN_BASE_URL") || "https://ilinkai.weixin.qq.com",
    weixinCdnBaseUrl: readTextEnv("HEART_ANCHOR_WEIXIN_CDN_BASE_URL") || "https://novac2c.cdn.weixin.qq.com/c2c",
    weixinConfigFile: path.join(stateDir, "weixin-config.json"),
    weixinMinChunkChars: readIntEnv("HEART_ANCHOR_WEIXIN_MIN_CHUNK_CHARS"),
    weixinQrBotType: readTextEnv("HEART_ANCHOR_WEIXIN_QR_BOT_TYPE") || "3",
    accountsDir: path.join(stateDir, "accounts"),
    reminderQueueFile: path.join(stateDir, "reminder-queue.json"),
    systemMessageQueueFile: path.join(stateDir, "system-message-queue.json"),
    deferredSystemReplyQueueFile: path.join(stateDir, "deferred-system-replies.json"),
    checkinConfigFile: path.join(stateDir, "checkin-config.json"),
    timelineScreenshotQueueFile: path.join(stateDir, "timeline-screenshot-queue.json"),
    projectToolContextFile: path.join(stateDir, "project-tool-runtime-context.json"),
    memoryDbFile: path.join(stateDir, "memory", "memory.sqlite"),
    memoryEmbeddingApiBaseUrl: readTextEnv("HEART_ANCHOR_MEMORY_EMBEDDING_API_BASE_URL"),
    memoryEmbeddingApiKey: readTextEnv("HEART_ANCHOR_MEMORY_EMBEDDING_API_KEY")
      || readTextEnv("HEART_ANCHOR_ALIYUN_DASHSCOPE_API_KEY")
      || readTextEnv("DASHSCOPE_API_KEY"),
    memoryEmbeddingModel: readTextEnv("HEART_ANCHOR_MEMORY_EMBEDDING_MODEL"),
    memoryEmbeddingTimeoutMs: readIntEnv("HEART_ANCHOR_MEMORY_EMBEDDING_TIMEOUT_MS") || 15_000,
    memoryHalfLifeDays: readIntEnv("HEART_ANCHOR_MEMORY_HALF_LIFE_DAYS") || 45,
    memoryRecallLimit: readIntEnv("HEART_ANCHOR_MEMORY_RECALL_LIMIT") || 8,
    memoryContextMaxChars: readIntEnv("HEART_ANCHOR_MEMORY_CONTEXT_MAX_CHARS") || 2_000,
    memorySimilarThreshold: readNumberEnv("HEART_ANCHOR_MEMORY_SIMILAR_THRESHOLD") ?? 0.86,
    memoryCandidateTtlDays: readIntEnv("HEART_ANCHOR_MEMORY_CANDIDATE_TTL_DAYS") || 14,
    startWithMemoryConsolidation: mode === "start" && readBoolEnv("HEART_ANCHOR_MEMORY_CONSOLIDATION"),
    memoryConsolidationTime: readTextEnv("HEART_ANCHOR_MEMORY_CONSOLIDATION_TIME") || "03:30",
    memoryConsolidationStatusFile: path.join(stateDir, "memory", "consolidation-status.json"),
    weixinInstructionsFile: path.join(stateDir, "weixin-instructions.md"),
    weixinOperationsFile: path.resolve(__dirname, "..", "..", "templates", "weixin-operations.md"),
    stickersDir: path.join(stateDir, "stickers"),
    stickerAssetsDir: path.join(stateDir, "stickers", "assets"),
    stickersIndexFile: path.join(stateDir, "stickers", "index.json"),
    stickerTagsFile: path.join(stateDir, "stickers", "tags.json"),
    stickersTemplateDir: path.resolve(__dirname, "..", "..", "templates", "stickers"),
    stickersTemplateIndexFile: path.resolve(__dirname, "..", "..", "templates", "stickers", "index.json"),
    stickerTagsTemplateFile: path.resolve(__dirname, "..", "..", "templates", "stickers", "tags.json"),
    stickerNormalizeGifScript: path.resolve(__dirname, "..", "..", "scripts", "normalize-sticker-gif.js"),
    diaryDir: path.join(stateDir, "diary"),
    voiceOutboxDir: path.join(stateDir, "voice-outbox"),
    androidEventsFile: path.join(stateDir, "android-events.jsonl"),
    calendarIcsUrls: readTextEnv("HEART_ANCHOR_CALENDAR_ICS_URLS"),
    calendarRefreshMs: readIntEnv("HEART_ANCHOR_CALENDAR_REFRESH_MS"),
    calendarHorizonMs: readIntEnv("HEART_ANCHOR_CALENDAR_HORIZON_MS"),
    calendarCacheFile: path.join(stateDir, "calendar-cache.json"),
    googleCalendarClientId,
    googleCalendarClientSecret,
    googleCalendarRefreshToken: readTextEnv("HEART_ANCHOR_GOOGLE_CALENDAR_REFRESH_TOKEN"),
    googleCalendarRedirectUri,
    googleCalendarId: readTextEnv("HEART_ANCHOR_GOOGLE_CALENDAR_ID") || "primary",
    googleCalendarTimeZone: readTextEnv("HEART_ANCHOR_GOOGLE_CALENDAR_TIME_ZONE") || "Asia/Shanghai",
    googleCalendarTokenFile: path.join(stateDir, "google-calendar-token.json"),
    googleGmailClientId: readTextEnv("HEART_ANCHOR_GOOGLE_GMAIL_CLIENT_ID") || googleCalendarClientId,
    googleGmailClientSecret: readTextEnv("HEART_ANCHOR_GOOGLE_GMAIL_CLIENT_SECRET") || googleCalendarClientSecret,
    googleGmailRefreshToken: readTextEnv("HEART_ANCHOR_GOOGLE_GMAIL_REFRESH_TOKEN"),
    googleGmailRedirectUri: readTextEnv("HEART_ANCHOR_GOOGLE_GMAIL_REDIRECT_URI") || googleCalendarRedirectUri,
    googleGmailTokenFile: path.join(stateDir, "google-gmail-token.json"),
    androidDevicesFile: path.join(stateDir, "android-devices.json"),
    androidCommandQueueFile: path.join(stateDir, "android-commands.json"),
    androidCommandsEnabled: readOptionalBoolEnv("HEART_ANCHOR_ANDROID_COMMANDS_ENABLED") ?? true,
    androidDefaultDeviceId: readTextEnv("HEART_ANCHOR_ANDROID_DEFAULT_DEVICE_ID") || "phone-main",
    androidWebhookHost: readTextEnv("HEART_ANCHOR_ANDROID_WEBHOOK_HOST") || "0.0.0.0",
    androidWebhookPort: readIntEnv("HEART_ANCHOR_ANDROID_WEBHOOK_PORT") || 4319,
    androidWebhookToken: readTextEnv("HEART_ANCHOR_ANDROID_WEBHOOK_TOKEN"),
    firebaseServiceAccountFile: readTextEnv("HEART_ANCHOR_FIREBASE_SERVICE_ACCOUNT_FILE"),
    firebaseMessagingTimeoutMs: readIntEnv("HEART_ANCHOR_FIREBASE_MESSAGING_TIMEOUT_MS") || 10_000,
    startWithAndroidWebhook: resolveAndroidWebhookEnabled({
      mode,
      enabled: readOptionalBoolEnv("HEART_ANCHOR_ENABLE_ANDROID_WEBHOOK"),
    }),
    locationStoreFile: path.join(stateDir, "locations.json"),
    locationHost: readTextEnv("HEART_ANCHOR_LOCATION_HOST") || "0.0.0.0",
    locationPort: readIntEnv("HEART_ANCHOR_LOCATION_PORT") || 4318,
    locationToken: readTextEnv("HEART_ANCHOR_LOCATION_TOKEN"),
    locationHistoryLimit: readIntEnv("HEART_ANCHOR_LOCATION_HISTORY_LIMIT") || 1000,
    locationMovementEventLimit: readIntEnv("HEART_ANCHOR_LOCATION_MOVEMENT_EVENT_LIMIT"),
    locationBatteryHistoryLimit: readIntEnv("HEART_ANCHOR_LOCATION_BATTERY_HISTORY_LIMIT"),
    locationKnownPlaces: readKnownPlacesEnv(),
    locationKnownPlaceRadiusMeters: readIntEnv("HEART_ANCHOR_LOCATION_PLACE_RADIUS_METERS") || 150,
    locationStayMergeRadiusMeters: readIntEnv("HEART_ANCHOR_LOCATION_STAY_MERGE_RADIUS_METERS") || 100,
    locationStayBreakConfirmRadiusMeters: readIntEnv("HEART_ANCHOR_LOCATION_STAY_BREAK_RADIUS_METERS") || 200,
    locationStayBreakConfirmSamples: readIntEnv("HEART_ANCHOR_LOCATION_STAY_BREAK_SAMPLES") || 2,
    locationMajorMoveThresholdMeters: readIntEnv("HEART_ANCHOR_LOCATION_MAJOR_MOVE_THRESHOLD_METERS") || 1000,
    startWithLocationServer: resolveLocationServerEnabled({
      mode,
      enabled: readOptionalBoolEnv("HEART_ANCHOR_ENABLE_LOCATION_SERVER"),
    }),
    syncBufferDir: path.join(stateDir, "sync-buffers"),
    codexEndpoint: readTextEnv("HEART_ANCHOR_CODEX_ENDPOINT"),
    codexCommand: readTextEnv("HEART_ANCHOR_CODEX_COMMAND"),
    codexModel: readTextEnv("HEART_ANCHOR_CODEX_MODEL"),
    codexModelProvider: readTextEnv("HEART_ANCHOR_CODEX_MODEL_PROVIDER"),
    codexModelPresets: readListEnv("HEART_ANCHOR_CODEX_MODEL_PRESETS"),
    codexNativeImageInput: readOptionalBoolEnv("HEART_ANCHOR_CODEX_NATIVE_IMAGE_INPUT"),
    antigravityCommand: readTextEnv("HEART_ANCHOR_ANTIGRAVITY_COMMAND") || "agy",
    antigravityModel: readTextEnv("HEART_ANCHOR_ANTIGRAVITY_MODEL"),
    antigravityPrintTimeout: readTextEnv("HEART_ANCHOR_ANTIGRAVITY_PRINT_TIMEOUT") || "5m0s",
    antigravityContinue: readOptionalBoolEnv("HEART_ANCHOR_ANTIGRAVITY_CONTINUE") ?? true,
    antigravityExtraArgs: readListEnv("HEART_ANCHOR_ANTIGRAVITY_EXTRA_ARGS"),
    visionMode: readTextEnv("HEART_ANCHOR_VISION_MODE") || "auto",
    visionProvider: readTextEnv("HEART_ANCHOR_VISION_PROVIDER") || "openai-compatible",
    visionApiBaseUrl: readTextEnv("HEART_ANCHOR_VISION_API_BASE_URL"),
    visionApiKey: readTextEnv("HEART_ANCHOR_VISION_API_KEY"),
    visionModel: readTextEnv("HEART_ANCHOR_VISION_MODEL"),
    visionTimeoutMs: readIntEnv("HEART_ANCHOR_VISION_TIMEOUT_MS") || 30_000,
    webSearchProvider: readTextEnv("HEART_ANCHOR_WEB_SEARCH_PROVIDER"),
    braveSearchApiKey: readTextEnv("HEART_ANCHOR_BRAVE_SEARCH_API_KEY"),
    tavilySearchApiKey: readTextEnv("HEART_ANCHOR_TAVILY_API_KEY"),
    bochaApiKey: readTextEnv("HEART_ANCHOR_BOCHA_API_KEY"),
    webSearchTimeoutMs: readIntEnv("HEART_ANCHOR_WEB_SEARCH_TIMEOUT_MS") || 10_000,
    trendingTimeoutMs: readIntEnv("HEART_ANCHOR_TRENDING_TIMEOUT_MS") || 10_000,
    neteaseSessionFile: path.join(stateDir, "netease-session.json"),
    neteaseCookie: readTextEnv("HEART_ANCHOR_NETEASE_COOKIE"),
    neteaseRealIp: readTextEnv("HEART_ANCHOR_NETEASE_REAL_IP"),
    neteaseProxy: readTextEnv("HEART_ANCHOR_NETEASE_PROXY"),
    neteaseTimeoutMs: readIntEnv("HEART_ANCHOR_NETEASE_TIMEOUT_MS") || 15_000,
    ttsDeliveryMode: readTextEnv("HEART_ANCHOR_TTS_DELIVERY_MODE") || "auto",
    ttsVoiceMaxSeconds: readIntEnv("HEART_ANCHOR_TTS_VOICE_MAX_SECONDS") || 5,
    ttsProvider: readTextEnv("HEART_ANCHOR_TTS_PROVIDER") || "elevenlabs",
    elevenLabsApiKey: readTextEnv("HEART_ANCHOR_ELEVENLABS_API_KEY"),
    elevenLabsBaseUrl: readTextEnv("HEART_ANCHOR_ELEVENLABS_BASE_URL"),
    elevenLabsVoiceId: readTextEnv("HEART_ANCHOR_ELEVENLABS_VOICE_ID"),
    elevenLabsModelId: readTextEnv("HEART_ANCHOR_ELEVENLABS_MODEL_ID"),
    elevenLabsOutputFormat: readTextEnv("HEART_ANCHOR_ELEVENLABS_OUTPUT_FORMAT"),
    elevenLabsSpeed: readNumberEnv("HEART_ANCHOR_ELEVENLABS_SPEED"),
    elevenLabsTimeoutMs: readIntEnv("HEART_ANCHOR_ELEVENLABS_TIMEOUT_MS") || 30_000,
    elevenLabsMaxTextChars: readIntEnv("HEART_ANCHOR_ELEVENLABS_MAX_TEXT_CHARS") || 600,
    aliyunDashscopeApiKey: readTextEnv("HEART_ANCHOR_ALIYUN_DASHSCOPE_API_KEY") || readTextEnv("DASHSCOPE_API_KEY"),
    aliyunWorkspaceId: readTextEnv("HEART_ANCHOR_ALIYUN_WORKSPACE_ID"),
    aliyunTtsUrl: readTextEnv("HEART_ANCHOR_ALIYUN_TTS_URL"),
    aliyunTtsEndpoint: readTextEnv("HEART_ANCHOR_ALIYUN_TTS_ENDPOINT"),
    aliyunTtsBaseUrl: readTextEnv("HEART_ANCHOR_ALIYUN_TTS_BASE_URL"),
    aliyunTtsModel: readTextEnv("HEART_ANCHOR_ALIYUN_TTS_MODEL") || "cosyvoice-v3.5-plus",
    aliyunTtsVoice: readTextEnv("HEART_ANCHOR_ALIYUN_TTS_VOICE"),
    aliyunTtsFormat: readTextEnv("HEART_ANCHOR_ALIYUN_TTS_FORMAT") || "mp3",
    aliyunTtsSampleRate: readIntEnv("HEART_ANCHOR_ALIYUN_TTS_SAMPLE_RATE") || 24_000,
    aliyunTtsVolume: readNumberEnv("HEART_ANCHOR_ALIYUN_TTS_VOLUME"),
    aliyunTtsRate: readNumberEnv("HEART_ANCHOR_ALIYUN_TTS_RATE"),
    aliyunTtsPitch: readNumberEnv("HEART_ANCHOR_ALIYUN_TTS_PITCH"),
    aliyunTtsInstruction: readTextEnv("HEART_ANCHOR_ALIYUN_TTS_INSTRUCTION"),
    aliyunTtsEnableSsml: readOptionalBoolEnv("HEART_ANCHOR_ALIYUN_TTS_ENABLE_SSML"),
    aliyunTtsTimeoutMs: readIntEnv("HEART_ANCHOR_ALIYUN_TTS_TIMEOUT_MS") || 30_000,
    aliyunTtsMaxTextChars: readIntEnv("HEART_ANCHOR_ALIYUN_TTS_MAX_TEXT_CHARS") || 600,
    claudeCommand: readTextEnv("HEART_ANCHOR_CLAUDE_COMMAND") || "claude",
    claudeModel: readTextEnv("HEART_ANCHOR_CLAUDE_MODEL") || "",
    claudeModelPresets: readListEnv("HEART_ANCHOR_CLAUDE_MODEL_PRESETS"),
    claudeContextWindow: readIntEnv("HEART_ANCHOR_CLAUDE_CONTEXT_WINDOW"),
    claudeMaxOutputTokens: readIntEnv("CLAUDE_CODE_MAX_OUTPUT_TOKENS"),
    claudePermissionMode: readTextEnv("HEART_ANCHOR_CLAUDE_PERMISSION_MODE") || "default",
    claudeDisableVerbose: readBoolEnv("HEART_ANCHOR_CLAUDE_DISABLE_VERBOSE"),
    claudeExtraArgs: readListEnv("HEART_ANCHOR_CLAUDE_EXTRA_ARGS"),
    sessionsFile: path.join(stateDir, "sessions.json"),
    startWithCheckin: (mode === "start" && hasArgFlag(argv, "--checkin")) || readBoolEnv("HEART_ANCHOR_ENABLE_CHECKIN"),
    startWithWebConsole: mode === "start" && (readOptionalBoolEnv("HEART_ANCHOR_WEB_CONSOLE") ?? true),
    webConsoleHost: readTextEnv("HEART_ANCHOR_WEB_CONSOLE_HOST") || "127.0.0.1",
    webConsolePort: readIntEnv("HEART_ANCHOR_WEB_CONSOLE_PORT") || 3210,
    webConsoleToken: readTextEnv("HEART_ANCHOR_WEB_CONSOLE_TOKEN"),
  };
}

function readListEnv(name) {
  return String(readEnvRaw(name) || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readTextEnv(name) {
  const value = readEnvRaw(name);
  return typeof value === "string" ? value.trim() : "";
}

function readBoolEnv(name) {
  const value = readTextEnv(name).toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function readOptionalBoolEnv(name) {
  const value = readTextEnv(name).toLowerCase();
  if (!value) {
    return undefined;
  }
  if (value === "1" || value === "true" || value === "yes" || value === "on") {
    return true;
  }
  if (value === "0" || value === "false" || value === "no" || value === "off") {
    return false;
  }
  return undefined;
}

function readIntEnv(name) {
  const value = readTextEnv(name);
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readNumberEnv(name) {
  const value = readTextEnv(name);
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readKnownPlacesEnv() {
  const fromJson = parseKnownPlacesJson(readTextEnv("HEART_ANCHOR_LOCATION_KNOWN_PLACES"));
  const fromCenters = [
    parseKnownPlaceCenter("home", readTextEnv("HEART_ANCHOR_LOCATION_HOME_CENTER")),
    parseKnownPlaceCenter("work", readTextEnv("HEART_ANCHOR_LOCATION_WORK_CENTER")),
  ].filter(Boolean);
  return [...fromJson, ...fromCenters];
}

function parseKnownPlacesJson(value) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseKnownPlaceCenter(tag, value) {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 2) {
    return null;
  }
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { tag, latitude, longitude };
}

function hasArgFlag(argv, flag) {
  return Array.isArray(argv) && argv.some((item) => String(item || "").trim() === flag);
}

function resolveLocationServerEnabled({ mode, enabled }) {
  if (mode !== "start") {
    return false;
  }
  if (typeof enabled === "boolean") {
    return enabled;
  }
  return false;
}

function resolveAndroidWebhookEnabled({ mode, enabled }) {
  if (mode !== "start") {
    return false;
  }
  if (typeof enabled === "boolean") {
    return enabled;
  }
  return false;
}

module.exports = { readConfig };
