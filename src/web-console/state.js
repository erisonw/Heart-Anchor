const fs = require("fs");
const os = require("os");
const path = require("path");

const { CheckinConfigStore, resolveDefaultCheckinRange } = require("../core/checkin-config-store");
const { formatContextStatusLine } = require("../core/context-format");
const { normalizeText } = require("../core/values");
const { buildSettingsView, readEnvFile, resolvePreferredEnvFile } = require("./env-store");
const { getLogBuffer } = require("./log-buffer");

const PROJECT_ROOT = process.env.CYBERBOSS_HOME || path.resolve(__dirname, "..", "..");
const MCP_CONFIG_FILE = path.join(PROJECT_ROOT, ".mcp.json");
const PACKAGE_VERSION = require("../../package.json").version;

function buildConsoleState({ app = null, config }) {
  const mode = app ? "embedded" : "standalone";
  const envFile = resolvePreferredEnvFile();
  const envValues = readEnvFile(envFile);
  const bindings = readBindingsSummary(config);
  const currentThread = readCurrentThreadState(config, bindings);
  const live = app ? buildLiveState(app, config, currentThread) : null;

  return {
    now: new Date().toISOString(),
    mode,
    meta: {
      version: PACKAGE_VERSION,
      nodeVersion: process.version,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      hostname: os.hostname(),
      projectRoot: PROJECT_ROOT,
      stateDir: config.stateDir,
      envFile,
    },
    overview: {
      channel: live?.channelId || normalizeText(config.channel),
      accountId: live?.accountId || normalizeText(config.accountId),
      runtime: live?.runtimeId || normalizeText(config.runtime),
      workspaceRoot: normalizeText(config.workspaceRoot),
      checkin: readCheckinState(config),
      androidWebhook: {
        enabled: Boolean(config.startWithAndroidWebhook),
        port: Number(config.androidWebhookPort || 0),
      },
      locationServer: {
        enabled: Boolean(config.startWithLocationServer),
        port: Number(config.locationPort || 0),
      },
      webConsole: {
        host: normalizeText(config.webConsoleHost),
        port: Number(config.webConsolePort || 0),
        tokenConfigured: Boolean(normalizeText(config.webConsoleToken)),
      },
    },
    currentThread: {
      ...currentThread,
      live: live?.thread || null,
      contextLine: live?.contextLine || "",
    },
    bindings,
    queue: readQueueState(app, config),
    android: readAndroidState(config),
    mcp: readMcpState(),
    settings: buildSettingsView(envValues),
    logs: app ? getLogBuffer().snapshot(150) : [],
  };
}

function buildLiveState(app, config, currentThread) {
  const result = {
    channelId: "",
    accountId: "",
    runtimeId: "",
    thread: null,
    contextLine: "",
  };
  try {
    result.channelId = normalizeText(app.channelAdapter?.describe?.()?.id);
  } catch {
    result.channelId = "";
  }
  result.accountId = normalizeText(app.activeAccountId);
  try {
    result.runtimeId = normalizeText(app.runtimeAdapter?.describe?.()?.id);
  } catch {
    result.runtimeId = "";
  }
  const threadId = normalizeText(currentThread?.threadId);
  const threadState = threadId ? app.threadStateStore?.getThreadState?.(threadId) : null;
  if (threadState) {
    result.thread = {
      status: threadState.status,
      turnId: threadState.turnId,
      lastError: threadState.lastError,
      pendingApproval: threadState.pendingApproval
        ? {
            kind: threadState.pendingApproval.kind,
            reason: threadState.pendingApproval.reason,
            command: threadState.pendingApproval.command,
          }
        : null,
      updatedAt: threadState.updatedAt,
    };
  }
  const context = threadState?.context
    || app.threadStateStore?.getLatestContext?.(result.runtimeId)
    || null;
  result.contextLine = formatContextStatusLine({
    runtimeName: result.runtimeId || normalizeText(config.runtime),
    context,
    claudeContextWindow: config.claudeContextWindow,
    claudeMaxOutputTokens: config.claudeMaxOutputTokens,
  });
  return result;
}

function readQueueState(app, config) {
  const systemMessages = readJsonFile(config.systemMessageQueueFile, {});
  const pendingSystem = Array.isArray(systemMessages?.messages) ? systemMessages.messages : [];
  const reminders = readReminderItems(config.reminderQueueFile);
  const deferredReplies = readJsonFile(config.deferredSystemReplyQueueFile, {});
  const deferredItems = Array.isArray(deferredReplies?.replies)
    ? deferredReplies.replies
    : Array.isArray(deferredReplies?.messages)
      ? deferredReplies.messages
      : [];
  return {
    systemMessages: {
      total: pendingSystem.length,
      recent: pendingSystem.slice(-8).reverse().map((item) => ({
        id: normalizeText(item?.id),
        accountId: normalizeText(item?.accountId),
        userId: normalizeText(item?.userId),
        text: truncate(normalizeText(item?.text), 200),
        notBefore: normalizeText(item?.notBefore || item?.notBeforeAt),
        createdAt: normalizeText(item?.createdAt),
      })),
    },
    reminders: {
      total: reminders.length,
      recent: reminders.slice(-8).reverse().map((item) => ({
        id: normalizeText(item?.id),
        text: truncate(normalizeText(item?.text || item?.message || item?.content), 200),
        dueAt: normalizeText(item?.dueAt || item?.remindAt || item?.at),
      })),
    },
    deferredReplies: {
      total: deferredItems.length,
    },
  };
}

function readReminderItems(filePath) {
  const parsed = readJsonFile(filePath, null);
  if (Array.isArray(parsed)) {
    return parsed.filter((item) => item && typeof item === "object");
  }
  if (parsed && typeof parsed === "object") {
    for (const value of Object.values(parsed)) {
      if (Array.isArray(value)) {
        return value.filter((item) => item && typeof item === "object");
      }
    }
  }
  return [];
}

function readBindingsSummary(config) {
  const data = readJsonFile(config.sessionsFile, {});
  const bindings = Object.entries(data.bindings || {})
    .map(([bindingKey, binding]) => normalizeBinding(bindingKey, binding, config))
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0));

  const active = bindings.find((binding) => binding.activeWorkspaceRoot === config.workspaceRoot)
    || bindings.find((binding) => binding.isActiveWorkspace)
    || null;

  return {
    total: bindings.length,
    active,
    recent: bindings.slice(0, 8),
  };
}

function normalizeBinding(bindingKey, binding, config) {
  if (!binding || typeof binding !== "object") {
    return null;
  }
  const activeWorkspaceRoot = normalizeText(binding.activeWorkspaceRoot);
  const runtime = normalizeText(config.runtime || "codex");
  const runtimeThreadMap = binding.threadIdByWorkspaceRootByRuntime
    && typeof binding.threadIdByWorkspaceRootByRuntime === "object"
    && binding.threadIdByWorkspaceRootByRuntime[runtime]
    && typeof binding.threadIdByWorkspaceRootByRuntime[runtime] === "object"
    ? binding.threadIdByWorkspaceRootByRuntime[runtime]
    : {};
  const runtimeParamsMap = binding.runtimeParamsByWorkspaceRootByRuntime
    && typeof binding.runtimeParamsByWorkspaceRootByRuntime === "object"
    && binding.runtimeParamsByWorkspaceRootByRuntime[runtime]
    && typeof binding.runtimeParamsByWorkspaceRootByRuntime[runtime] === "object"
    ? binding.runtimeParamsByWorkspaceRootByRuntime[runtime]
    : {};
  const workspaceRoots = Array.from(new Set([
    ...Object.keys(runtimeThreadMap),
    ...Object.keys(runtimeParamsMap),
    activeWorkspaceRoot,
  ].filter(Boolean))).sort();
  const workspaces = workspaceRoots.map((workspaceRoot) => {
    const runtimeParams = runtimeParamsMap[workspaceRoot] || {};
    return {
      workspaceRoot,
      threadId: normalizeText(runtimeThreadMap[workspaceRoot]) || "",
      model: normalizeText(runtimeParams.model),
      modelProvider: normalizeText(runtimeParams.modelProvider || runtimeParams.model_provider),
      isActiveWorkspace: workspaceRoot === activeWorkspaceRoot,
      matchesCurrentProject: workspaceRoot === normalizeText(config.workspaceRoot),
    };
  });
  const activeWorkspace = workspaces.find((item) => item.workspaceRoot === activeWorkspaceRoot) || null;
  return {
    bindingKey: normalizeText(bindingKey),
    accountId: normalizeText(binding.accountId),
    senderId: normalizeText(binding.senderId),
    activeWorkspaceRoot,
    workspaceRoot: activeWorkspaceRoot,
    threadId: activeWorkspace?.threadId || "",
    model: activeWorkspace?.model || "",
    modelProvider: activeWorkspace?.modelProvider || "",
    updatedAt: normalizeText(binding.updatedAt),
    isActiveWorkspace: activeWorkspaceRoot === normalizeText(config.workspaceRoot),
    workspaceCount: workspaces.length,
    workspaces,
  };
}

function readCurrentThreadState(config, bindingsSummary = null) {
  const bindings = bindingsSummary || readBindingsSummary(config);
  const activeBinding = bindings.active || null;
  const fallbackWorkspaceRoot = normalizeText(config.workspaceRoot);
  const workspaceRoot = normalizeText(activeBinding?.activeWorkspaceRoot || fallbackWorkspaceRoot);
  const activeWorkspace = Array.isArray(activeBinding?.workspaces)
    ? activeBinding.workspaces.find((item) => normalizeText(item.workspaceRoot) === workspaceRoot) || null
    : null;
  const threadId = normalizeText(activeWorkspace?.threadId || activeBinding?.threadId);
  const runtime = normalizeText(config.runtime || "codex");
  const model = normalizeText(
    activeWorkspace?.model
      || activeBinding?.model
      || (runtime === "claudecode" ? config.claudeModel : config.codexModel)
  );
  return {
    bindingKey: normalizeText(activeBinding?.bindingKey),
    workspaceRoot,
    threadId,
    runtime,
    model,
    updatedAt: normalizeText(activeBinding?.updatedAt),
    hasBinding: Boolean(activeBinding?.bindingKey),
    matchesCurrentProject: activeWorkspace
      ? Boolean(activeWorkspace.matchesCurrentProject)
      : workspaceRoot === fallbackWorkspaceRoot,
    canStartFresh: Boolean(activeBinding?.bindingKey && workspaceRoot),
    canCompact: Boolean(activeBinding?.bindingKey && workspaceRoot && threadId),
  };
}

function readCheckinState(config) {
  const store = new CheckinConfigStore({ filePath: config.checkinConfigFile });
  const range = store.getRange(resolveDefaultCheckinRange(process.env));
  return {
    enabled: Boolean(config.startWithCheckin),
    minMinutes: Math.round(range.minIntervalMs / 60_000),
    maxMinutes: Math.round(range.maxIntervalMs / 60_000),
  };
}

function readMcpState() {
  const parsed = readJsonFile(MCP_CONFIG_FILE, {});
  const enabled = parsed.mcpServers && typeof parsed.mcpServers === "object" ? parsed.mcpServers : {};
  const disabled = parsed.disabledMcpServers && typeof parsed.disabledMcpServers === "object" ? parsed.disabledMcpServers : {};
  const names = Array.from(new Set([...Object.keys(enabled), ...Object.keys(disabled)])).sort();
  return {
    filePath: MCP_CONFIG_FILE,
    servers: names.map((name) => ({
      name,
      enabled: Boolean(enabled[name]),
      canToggle: name !== "cyberboss_tools",
      command: normalizeText((enabled[name] || disabled[name] || {}).command),
    })),
  };
}

function readAndroidState(config) {
  const parsed = readJsonFile(config.androidDevicesFile, {});
  const devices = parsed.devices && typeof parsed.devices === "object" ? parsed.devices : {};
  const items = Object.values(devices)
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      deviceId: normalizeText(item.deviceId),
      lastSeenAt: normalizeText(item.lastSeenAt),
      lastEventAt: normalizeText(item.lastEventAt),
      lastEventType: normalizeText(item.lastEventType),
      lastSummary: normalizeText(item.lastSummary),
      acceptedCount: Number(item.acceptedCount || 0),
      duplicateCount: Number(item.duplicateCount || 0),
    }))
    .sort((left, right) => Date.parse(right.lastSeenAt || 0) - Date.parse(left.lastSeenAt || 0));
  return {
    enabled: Boolean(config.startWithAndroidWebhook),
    host: normalizeText(config.androidWebhookHost),
    port: Number(config.androidWebhookPort || 0),
    tokenConfigured: Boolean(normalizeText(config.androidWebhookToken)),
    totalDevices: items.length,
    devices: items.slice(0, 6),
    recentEvents: readRecentAndroidEvents(config.androidEventsFile, 12),
  };
}

function readRecentAndroidEvents(filePath, limit = 12) {
  const text = readTextFile(filePath);
  if (!text) {
    return [];
  }
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-Math.max(1, limit))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      eventId: normalizeText(item.eventId || item.id),
      eventType: normalizeText(item.eventType),
      deviceId: normalizeText(item.deviceId),
      occurredAt: normalizeText(item.occurredAt),
      receivedAt: normalizeText(item.receivedAt),
      summary: truncate(normalizeText(item.summary), 160),
    }))
    .sort((left, right) => Date.parse(right.occurredAt || right.receivedAt || 0) - Date.parse(left.occurredAt || left.receivedAt || 0));
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function truncate(text, limit) {
  const normalized = String(text || "");
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

module.exports = {
  buildConsoleState,
  readBindingsSummary,
  readCurrentThreadState,
  readCheckinState,
  readMcpState,
  readAndroidState,
  MCP_CONFIG_FILE,
};
