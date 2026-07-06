const os = require("os");
const path = require("path");

function readConfig() {
  const argv = process.argv.slice(2);
  const mode = argv[0] || "";
  const stateDir = process.env.CYBERBOSS_STATE_DIR || path.join(os.homedir(), ".cyberboss");
  const googleCalendarClientId = readTextEnv("CYBERBOSS_GOOGLE_CALENDAR_CLIENT_ID");
  const googleCalendarClientSecret = readTextEnv("CYBERBOSS_GOOGLE_CALENDAR_CLIENT_SECRET");
  const googleCalendarRedirectUri = readTextEnv("CYBERBOSS_GOOGLE_CALENDAR_REDIRECT_URI");

  return {
    mode,
    argv,
    stateDir,
    workspaceId: readTextEnv("CYBERBOSS_WORKSPACE_ID") || "default",
    workspaceRoot: readTextEnv("CYBERBOSS_WORKSPACE_ROOT") || process.cwd(),
    userName: readTextEnv("CYBERBOSS_USER_NAME") || "User",
    userGender: readTextEnv("CYBERBOSS_USER_GENDER") || "female",
    allowedUserIds: readListEnv("CYBERBOSS_ALLOWED_USER_IDS"),
    channel: readTextEnv("CYBERBOSS_CHANNEL") || "weixin",
    telegramBotToken: readTextEnv("CYBERBOSS_TELEGRAM_BOT_TOKEN"),
    telegramAllowedChatIds: readListEnv("CYBERBOSS_TELEGRAM_ALLOWED_CHAT_IDS"),
    telegramApiBaseUrl: readTextEnv("CYBERBOSS_TELEGRAM_API_BASE_URL") || "https://api.telegram.org",
    telegramPollTimeoutMs: readIntEnv("CYBERBOSS_TELEGRAM_POLL_TIMEOUT_MS"),
    telegramTransport: readTextEnv("CYBERBOSS_TELEGRAM_TRANSPORT"),
    telegramMinChunkChars: readIntEnv("CYBERBOSS_TELEGRAM_MIN_CHUNK_CHARS"),
    telegramVoiceOpusBitrate: readTextEnv("CYBERBOSS_TELEGRAM_VOICE_OPUS_BITRATE") || "64k",
    telegramVoiceOpusApplication: readTextEnv("CYBERBOSS_TELEGRAM_VOICE_OPUS_APPLICATION") || "audio",
    runtime: readTextEnv("CYBERBOSS_RUNTIME") || "codex",
    timelineCommand: readTextEnv("CYBERBOSS_TIMELINE_COMMAND") || "timeline-for-agent",
    accountId: readTextEnv("CYBERBOSS_ACCOUNT_ID"),
    weixinBaseUrl: readTextEnv("CYBERBOSS_WEIXIN_BASE_URL") || "https://ilinkai.weixin.qq.com",
    weixinCdnBaseUrl: readTextEnv("CYBERBOSS_WEIXIN_CDN_BASE_URL") || "https://novac2c.cdn.weixin.qq.com/c2c",
    weixinConfigFile: path.join(stateDir, "weixin-config.json"),
    weixinMinChunkChars: readIntEnv("CYBERBOSS_WEIXIN_MIN_CHUNK_CHARS"),
    weixinQrBotType: readTextEnv("CYBERBOSS_WEIXIN_QR_BOT_TYPE") || "3",
    accountsDir: path.join(stateDir, "accounts"),
    reminderQueueFile: path.join(stateDir, "reminder-queue.json"),
    systemMessageQueueFile: path.join(stateDir, "system-message-queue.json"),
    deferredSystemReplyQueueFile: path.join(stateDir, "deferred-system-replies.json"),
    checkinConfigFile: path.join(stateDir, "checkin-config.json"),
    timelineScreenshotQueueFile: path.join(stateDir, "timeline-screenshot-queue.json"),
    projectToolContextFile: path.join(stateDir, "project-tool-runtime-context.json"),
    memoryDbFile: path.join(stateDir, "memory", "memory.sqlite"),
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
    calendarIcsUrls: readTextEnv("CYBERBOSS_CALENDAR_ICS_URLS"),
    calendarRefreshMs: readIntEnv("CYBERBOSS_CALENDAR_REFRESH_MS"),
    calendarHorizonMs: readIntEnv("CYBERBOSS_CALENDAR_HORIZON_MS"),
    calendarCacheFile: path.join(stateDir, "calendar-cache.json"),
    googleCalendarClientId,
    googleCalendarClientSecret,
    googleCalendarRefreshToken: readTextEnv("CYBERBOSS_GOOGLE_CALENDAR_REFRESH_TOKEN"),
    googleCalendarRedirectUri,
    googleCalendarId: readTextEnv("CYBERBOSS_GOOGLE_CALENDAR_ID") || "primary",
    googleCalendarTimeZone: readTextEnv("CYBERBOSS_GOOGLE_CALENDAR_TIME_ZONE") || "Asia/Shanghai",
    googleCalendarTokenFile: path.join(stateDir, "google-calendar-token.json"),
    googleGmailClientId: readTextEnv("CYBERBOSS_GOOGLE_GMAIL_CLIENT_ID") || googleCalendarClientId,
    googleGmailClientSecret: readTextEnv("CYBERBOSS_GOOGLE_GMAIL_CLIENT_SECRET") || googleCalendarClientSecret,
    googleGmailRefreshToken: readTextEnv("CYBERBOSS_GOOGLE_GMAIL_REFRESH_TOKEN"),
    googleGmailRedirectUri: readTextEnv("CYBERBOSS_GOOGLE_GMAIL_REDIRECT_URI") || googleCalendarRedirectUri,
    googleGmailTokenFile: path.join(stateDir, "google-gmail-token.json"),
    androidDevicesFile: path.join(stateDir, "android-devices.json"),
    androidCommandQueueFile: path.join(stateDir, "android-commands.json"),
    androidCommandsEnabled: readOptionalBoolEnv("CYBERBOSS_ANDROID_COMMANDS_ENABLED") ?? true,
    androidDefaultDeviceId: readTextEnv("CYBERBOSS_ANDROID_DEFAULT_DEVICE_ID") || "phone-main",
    androidWebhookHost: readTextEnv("CYBERBOSS_ANDROID_WEBHOOK_HOST") || "0.0.0.0",
    androidWebhookPort: readIntEnv("CYBERBOSS_ANDROID_WEBHOOK_PORT") || 4319,
    androidWebhookToken: readTextEnv("CYBERBOSS_ANDROID_WEBHOOK_TOKEN"),
    firebaseServiceAccountFile: readTextEnv("CYBERBOSS_FIREBASE_SERVICE_ACCOUNT_FILE"),
    firebaseMessagingTimeoutMs: readIntEnv("CYBERBOSS_FIREBASE_MESSAGING_TIMEOUT_MS") || 10_000,
    startWithAndroidWebhook: resolveAndroidWebhookEnabled({
      mode,
      enabled: readOptionalBoolEnv("CYBERBOSS_ENABLE_ANDROID_WEBHOOK"),
    }),
    locationStoreFile: path.join(stateDir, "locations.json"),
    locationHost: readTextEnv("CYBERBOSS_LOCATION_HOST") || "0.0.0.0",
    locationPort: readIntEnv("CYBERBOSS_LOCATION_PORT") || 4318,
    locationToken: readTextEnv("CYBERBOSS_LOCATION_TOKEN"),
    locationHistoryLimit: readIntEnv("CYBERBOSS_LOCATION_HISTORY_LIMIT") || 1000,
    locationMovementEventLimit: readIntEnv("CYBERBOSS_LOCATION_MOVEMENT_EVENT_LIMIT"),
    locationBatteryHistoryLimit: readIntEnv("CYBERBOSS_LOCATION_BATTERY_HISTORY_LIMIT"),
    locationKnownPlaces: readKnownPlacesEnv(),
    locationKnownPlaceRadiusMeters: readIntEnv("CYBERBOSS_LOCATION_PLACE_RADIUS_METERS") || 150,
    locationStayMergeRadiusMeters: readIntEnv("CYBERBOSS_LOCATION_STAY_MERGE_RADIUS_METERS") || 100,
    locationStayBreakConfirmRadiusMeters: readIntEnv("CYBERBOSS_LOCATION_STAY_BREAK_RADIUS_METERS") || 200,
    locationStayBreakConfirmSamples: readIntEnv("CYBERBOSS_LOCATION_STAY_BREAK_SAMPLES") || 2,
    locationMajorMoveThresholdMeters: readIntEnv("CYBERBOSS_LOCATION_MAJOR_MOVE_THRESHOLD_METERS") || 1000,
    startWithLocationServer: resolveLocationServerEnabled({
      mode,
      enabled: readOptionalBoolEnv("CYBERBOSS_ENABLE_LOCATION_SERVER"),
    }),
    syncBufferDir: path.join(stateDir, "sync-buffers"),
    codexEndpoint: readTextEnv("CYBERBOSS_CODEX_ENDPOINT"),
    codexCommand: readTextEnv("CYBERBOSS_CODEX_COMMAND"),
    codexModel: readTextEnv("CYBERBOSS_CODEX_MODEL"),
    codexModelProvider: readTextEnv("CYBERBOSS_CODEX_MODEL_PROVIDER"),
    codexModelPresets: readListEnv("CYBERBOSS_CODEX_MODEL_PRESETS"),
    codexNativeImageInput: readOptionalBoolEnv("CYBERBOSS_CODEX_NATIVE_IMAGE_INPUT"),
    antigravityCommand: readTextEnv("CYBERBOSS_ANTIGRAVITY_COMMAND") || "agy",
    antigravityModel: readTextEnv("CYBERBOSS_ANTIGRAVITY_MODEL"),
    antigravityPrintTimeout: readTextEnv("CYBERBOSS_ANTIGRAVITY_PRINT_TIMEOUT") || "5m0s",
    antigravityContinue: readOptionalBoolEnv("CYBERBOSS_ANTIGRAVITY_CONTINUE") ?? true,
    antigravityExtraArgs: readListEnv("CYBERBOSS_ANTIGRAVITY_EXTRA_ARGS"),
    visionMode: readTextEnv("CYBERBOSS_VISION_MODE") || "auto",
    visionProvider: readTextEnv("CYBERBOSS_VISION_PROVIDER") || "openai-compatible",
    visionApiBaseUrl: readTextEnv("CYBERBOSS_VISION_API_BASE_URL"),
    visionApiKey: readTextEnv("CYBERBOSS_VISION_API_KEY"),
    visionModel: readTextEnv("CYBERBOSS_VISION_MODEL"),
    visionTimeoutMs: readIntEnv("CYBERBOSS_VISION_TIMEOUT_MS") || 30_000,
    webSearchProvider: readTextEnv("CYBERBOSS_WEB_SEARCH_PROVIDER"),
    braveSearchApiKey: readTextEnv("CYBERBOSS_BRAVE_SEARCH_API_KEY"),
    tavilySearchApiKey: readTextEnv("CYBERBOSS_TAVILY_API_KEY"),
    webSearchTimeoutMs: readIntEnv("CYBERBOSS_WEB_SEARCH_TIMEOUT_MS") || 10_000,
    trendingTimeoutMs: readIntEnv("CYBERBOSS_TRENDING_TIMEOUT_MS") || 10_000,
    neteaseSessionFile: path.join(stateDir, "netease-session.json"),
    neteaseCookie: readTextEnv("CYBERBOSS_NETEASE_COOKIE"),
    neteaseRealIp: readTextEnv("CYBERBOSS_NETEASE_REAL_IP"),
    neteaseProxy: readTextEnv("CYBERBOSS_NETEASE_PROXY"),
    neteaseTimeoutMs: readIntEnv("CYBERBOSS_NETEASE_TIMEOUT_MS") || 15_000,
    ttsDeliveryMode: readTextEnv("CYBERBOSS_TTS_DELIVERY_MODE") || "auto",
    ttsVoiceMaxSeconds: readIntEnv("CYBERBOSS_TTS_VOICE_MAX_SECONDS") || 5,
    ttsProvider: readTextEnv("CYBERBOSS_TTS_PROVIDER") || "elevenlabs",
    elevenLabsApiKey: readTextEnv("CYBERBOSS_ELEVENLABS_API_KEY"),
    elevenLabsBaseUrl: readTextEnv("CYBERBOSS_ELEVENLABS_BASE_URL"),
    elevenLabsVoiceId: readTextEnv("CYBERBOSS_ELEVENLABS_VOICE_ID"),
    elevenLabsModelId: readTextEnv("CYBERBOSS_ELEVENLABS_MODEL_ID"),
    elevenLabsOutputFormat: readTextEnv("CYBERBOSS_ELEVENLABS_OUTPUT_FORMAT"),
    elevenLabsSpeed: readNumberEnv("CYBERBOSS_ELEVENLABS_SPEED"),
    elevenLabsTimeoutMs: readIntEnv("CYBERBOSS_ELEVENLABS_TIMEOUT_MS") || 30_000,
    elevenLabsMaxTextChars: readIntEnv("CYBERBOSS_ELEVENLABS_MAX_TEXT_CHARS") || 600,
    aliyunDashscopeApiKey: readTextEnv("CYBERBOSS_ALIYUN_DASHSCOPE_API_KEY") || readTextEnv("DASHSCOPE_API_KEY"),
    aliyunWorkspaceId: readTextEnv("CYBERBOSS_ALIYUN_WORKSPACE_ID"),
    aliyunTtsUrl: readTextEnv("CYBERBOSS_ALIYUN_TTS_URL"),
    aliyunTtsEndpoint: readTextEnv("CYBERBOSS_ALIYUN_TTS_ENDPOINT"),
    aliyunTtsBaseUrl: readTextEnv("CYBERBOSS_ALIYUN_TTS_BASE_URL"),
    aliyunTtsModel: readTextEnv("CYBERBOSS_ALIYUN_TTS_MODEL") || "cosyvoice-v3.5-plus",
    aliyunTtsVoice: readTextEnv("CYBERBOSS_ALIYUN_TTS_VOICE"),
    aliyunTtsFormat: readTextEnv("CYBERBOSS_ALIYUN_TTS_FORMAT") || "mp3",
    aliyunTtsSampleRate: readIntEnv("CYBERBOSS_ALIYUN_TTS_SAMPLE_RATE") || 24_000,
    aliyunTtsVolume: readNumberEnv("CYBERBOSS_ALIYUN_TTS_VOLUME"),
    aliyunTtsRate: readNumberEnv("CYBERBOSS_ALIYUN_TTS_RATE"),
    aliyunTtsPitch: readNumberEnv("CYBERBOSS_ALIYUN_TTS_PITCH"),
    aliyunTtsInstruction: readTextEnv("CYBERBOSS_ALIYUN_TTS_INSTRUCTION"),
    aliyunTtsEnableSsml: readOptionalBoolEnv("CYBERBOSS_ALIYUN_TTS_ENABLE_SSML"),
    aliyunTtsTimeoutMs: readIntEnv("CYBERBOSS_ALIYUN_TTS_TIMEOUT_MS") || 30_000,
    aliyunTtsMaxTextChars: readIntEnv("CYBERBOSS_ALIYUN_TTS_MAX_TEXT_CHARS") || 600,
    claudeCommand: readTextEnv("CYBERBOSS_CLAUDE_COMMAND") || "claude",
    claudeModel: readTextEnv("CYBERBOSS_CLAUDE_MODEL") || "",
    claudeModelPresets: readListEnv("CYBERBOSS_CLAUDE_MODEL_PRESETS"),
    claudeContextWindow: readIntEnv("CYBERBOSS_CLAUDE_CONTEXT_WINDOW"),
    claudeMaxOutputTokens: readIntEnv("CLAUDE_CODE_MAX_OUTPUT_TOKENS"),
    claudePermissionMode: readTextEnv("CYBERBOSS_CLAUDE_PERMISSION_MODE") || "default",
    claudeDisableVerbose: readBoolEnv("CYBERBOSS_CLAUDE_DISABLE_VERBOSE"),
    claudeExtraArgs: readListEnv("CYBERBOSS_CLAUDE_EXTRA_ARGS"),
    sessionsFile: path.join(stateDir, "sessions.json"),
    startWithCheckin: (mode === "start" && hasArgFlag(argv, "--checkin")) || readBoolEnv("CYBERBOSS_ENABLE_CHECKIN"),
    startWithWebConsole: mode === "start" && (readOptionalBoolEnv("CYBERBOSS_WEB_CONSOLE") ?? true),
    webConsoleHost: readTextEnv("CYBERBOSS_WEB_CONSOLE_HOST") || "127.0.0.1",
    webConsolePort: readIntEnv("CYBERBOSS_WEB_CONSOLE_PORT") || 3210,
    webConsoleToken: readTextEnv("CYBERBOSS_WEB_CONSOLE_TOKEN"),
  };
}

function readListEnv(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readTextEnv(name) {
  const value = process.env[name];
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
  const fromJson = parseKnownPlacesJson(readTextEnv("CYBERBOSS_LOCATION_KNOWN_PLACES"));
  const fromCenters = [
    parseKnownPlaceCenter("home", readTextEnv("CYBERBOSS_LOCATION_HOME_CENTER")),
    parseKnownPlaceCenter("work", readTextEnv("CYBERBOSS_LOCATION_WORK_CENTER")),
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
