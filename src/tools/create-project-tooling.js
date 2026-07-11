const { createChannelAdapter } = require("../adapters/channel");
const { SessionStore } = require("../adapters/runtime/codex/session-store");
const { createTimelineIntegration } = require("../integrations/timeline");
const { ChannelFileService } = require("../services/channel-file-service");
const { CalendarService } = require("../services/calendar-service");
const { DiaryService } = require("../services/diary-service");
const { GoogleCalendarService } = require("../services/google-calendar-service");
const { GoogleGmailService } = require("../services/google-gmail-service");
const { MemoryService } = require("../services/memory-service");
const { MemoryEmbeddingService } = require("../services/memory-embedding-service");
const { createTtsService } = require("../services/tts-service");
const { ReminderService } = require("../services/reminder-service");
const { AndroidCommandService } = require("../services/android-command-service");
const { AndroidDeviceService } = require("../services/android-device-service");
const { AndroidIngestService } = require("../services/android-ingest-service");
const { FirebaseMessagingService } = require("../services/firebase-messaging-service");
const { NeteaseMusicService } = require("../services/netease-music-service");
const { StickerService } = require("../services/sticker-service");
const { SystemMessageService } = require("../services/system-message-service");
const { TimelineService } = require("../services/timeline-service");
const { TrendingService } = require("../services/trending-service");
const { WebSearchService } = require("../services/web-search-service");
const { VoiceTranscodeService } = require("../services/voice-transcode-service");
const { RuntimeContextStore } = require("./runtime-context-store");
const { ProjectToolHost } = require("./tool-host");
const { WhereaboutsService } = require("whereabouts-mcp");

function createProjectTooling(config, options = {}) {
  const sessionStore = options.sessionStore || new SessionStore({
    filePath: config.sessionsFile,
    runtimeId: config.runtime || "codex",
  });
  const channelAdapter = options.channelAdapter || createChannelAdapter(config);
  const timelineIntegration = options.timelineIntegration || createTimelineIntegration(config);
  const runtimeContextStore = options.runtimeContextStore || new RuntimeContextStore({
    filePath: config.projectToolContextFile,
  });
  const voiceTranscoder = new VoiceTranscodeService({
    telegramVoiceOpusBitrate: config.telegramVoiceOpusBitrate,
    telegramVoiceOpusApplication: config.telegramVoiceOpusApplication,
  });
  const channelFile = new ChannelFileService({ config, channelAdapter, sessionStore, voiceTranscoder });
  const firebaseMessaging = new FirebaseMessagingService({ config });
  const androidCommands = new AndroidCommandService({
    config,
    pushSender: firebaseMessaging,
  });
  const androidDevices = new AndroidDeviceService({
    config,
    pushSender: firebaseMessaging,
  });
  const services = {
    diary: new DiaryService({ config }),
    tts: createTtsService({ config }),
    reminder: new ReminderService({ config, sessionStore, channelAdapter }),
    system: new SystemMessageService({ config, sessionStore, channelAdapter }),
    webSearch: new WebSearchService({ config }),
    trending: new TrendingService({ timeoutMs: config.trendingTimeoutMs }),
    calendar: new CalendarService({ config }),
    googleCalendar: new GoogleCalendarService({ config }),
    googleGmail: new GoogleGmailService({ config }),
    memory: new MemoryService({ config, embedder: new MemoryEmbeddingService({ config }) }),
    netease: new NeteaseMusicService({ config }),
    voiceTranscoder,
    androidCommands,
    androidDevices,
    firebaseMessaging,
    androidIngest: new AndroidIngestService({ config, commandService: androidCommands, deviceService: androidDevices }),
    channelFile,
    sticker: new StickerService({ config, channelAdapter, sessionStore, channelFileService: channelFile }),
    timeline: new TimelineService({ config, timelineIntegration, sessionStore, channelAdapter }),
    whereabouts: new WhereaboutsService({
      config: {
        storeFile: config.locationStoreFile,
        host: config.locationHost,
        port: config.locationPort,
        token: config.locationToken,
        historyLimit: config.locationHistoryLimit,
        movementEventLimit: config.locationMovementEventLimit,
        batteryHistoryLimit: config.locationBatteryHistoryLimit,
        knownPlaces: config.locationKnownPlaces,
        knownPlaceRadiusMeters: config.locationKnownPlaceRadiusMeters,
        stayMergeRadiusMeters: config.locationStayMergeRadiusMeters,
        stayBreakConfirmRadiusMeters: config.locationStayBreakConfirmRadiusMeters,
        stayBreakConfirmSamples: config.locationStayBreakConfirmSamples,
        majorMoveThresholdMeters: config.locationMajorMoveThresholdMeters,
      },
    }),
  };
  const toolHost = new ProjectToolHost({
    services,
    runtimeContextStore,
  });
  return {
    services,
    toolHost,
    runtimeContextStore,
  };
}

module.exports = { createProjectTooling };
