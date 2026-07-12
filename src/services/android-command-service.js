const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_EXPIRES_MS = 10 * 60_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const TERMINAL_COMMAND_RETENTION_MS = 30 * 24 * 60 * 60_000;
const MAX_TERMINAL_COMMANDS_PER_DEVICE = 1_000;
const TERMINAL_COMMAND_STATES = new Set(["acked", "failed", "expired"]);

class AndroidCommandService {
  constructor({ config = {}, now = () => new Date().toISOString(), pushSender = null } = {}) {
    this.config = config;
    this.now = now;
    this.pushSender = pushSender;
    this.filePath = normalizeText(config.androidCommandQueueFile);
    this.defaultDeviceId = normalizeText(config.androidDefaultDeviceId) || "android-main";
  }

  isEnabled() {
    return this.config.androidCommandsEnabled !== false;
  }

  registerDevice({ deviceId, deviceName = "", fcmToken = "", platform = "android" } = {}) {
    this.assertEnabled();
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    const nowIso = this.nowIso();
    const state = this.readState();
    const existing = state.devices[normalizedDeviceId] || {};
    const device = {
      ...existing,
      deviceId: normalizedDeviceId,
      deviceName: normalizeText(deviceName) || normalizeText(existing.deviceName),
      platform: normalizeText(platform) || normalizeText(existing.platform) || "android",
      fcmToken: normalizeText(fcmToken) || normalizeText(existing.fcmToken),
      updatedAt: nowIso,
      registeredAt: normalizeText(existing.registeredAt) || nowIso,
    };
    state.devices[normalizedDeviceId] = device;
    this.writeState(state);
    return device;
  }

  updateFcmToken({ deviceId, fcmToken } = {}) {
    const token = normalizeText(fcmToken);
    if (!token) {
      throw new Error("Android FCM token is required.");
    }
    return this.registerDevice({ deviceId, fcmToken: token });
  }

  async enqueueAlarm({ deviceId, hour, minute, label = "", skipUi = true, expiresAt = "", commandId = "", createdBy = "tool" } = {}) {
    const normalizedHour = normalizeInteger(hour);
    const normalizedMinute = normalizeInteger(minute);
    if (!Number.isInteger(normalizedHour) || normalizedHour < 0 || normalizedHour > 23) {
      throw new Error("Android alarm hour must be an integer from 0 to 23.");
    }
    if (!Number.isInteger(normalizedMinute) || normalizedMinute < 0 || normalizedMinute > 59) {
      throw new Error("Android alarm minute must be an integer from 0 to 59.");
    }
    return await this.enqueueCommand({
      commandId,
      deviceId,
      type: "set_alarm",
      payload: {
        hour: normalizedHour,
        minute: normalizedMinute,
        label: normalizeText(label),
        skipUi: skipUi !== false,
      },
      expiresAt,
      createdBy,
    });
  }

  async enqueueTimer({ deviceId, durationSeconds, label = "", skipUi = true, expiresAt = "", commandId = "", createdBy = "tool" } = {}) {
    const normalizedDuration = normalizeInteger(durationSeconds);
    if (!Number.isInteger(normalizedDuration) || normalizedDuration < 1 || normalizedDuration > 86_400) {
      throw new Error("Android timer durationSeconds must be an integer from 1 to 86400.");
    }
    return await this.enqueueCommand({
      commandId,
      deviceId,
      type: "set_timer",
      payload: {
        durationSeconds: normalizedDuration,
        label: normalizeText(label),
        skipUi: skipUi !== false,
      },
      expiresAt,
      createdBy,
    });
  }

  async enqueueCommand({ commandId = "", deviceId, type, payload = {}, expiresAt = "", createdBy = "tool" } = {}) {
    this.assertEnabled();
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    const normalizedType = normalizeText(type);
    if (!["set_alarm", "set_timer"].includes(normalizedType)) {
      throw new Error("Android command type must be set_alarm or set_timer.");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Android command payload must be an object.");
    }
    const state = this.readState();
    const normalizedCommandId = normalizeText(commandId) || crypto.randomUUID();
    const existing = state.commands.find((command) => command.commandId === normalizedCommandId);
    if (existing) {
      return { ...existing, duplicate: true };
    }
    const nowIso = this.nowIso();
    const command = {
      commandId: normalizedCommandId,
      deviceId: normalizedDeviceId,
      type: normalizedType,
      status: "queued",
      payload: {
        ...payload,
        commandId: normalizedCommandId,
        expiresAt: normalizeIsoTime(expiresAt) || offsetIso(nowIso, DEFAULT_EXPIRES_MS),
      },
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: normalizeIsoTime(expiresAt) || offsetIso(nowIso, DEFAULT_EXPIRES_MS),
      createdBy: normalizeText(createdBy) || "tool",
      deliveryCount: 0,
      lastDeliveredAt: "",
      ackedAt: "",
      failedAt: "",
      error: "",
      result: null,
    };
    state.commands.push(command);
    this.writeState(state);
    await this.notifyDevice(normalizedDeviceId);
    return command;
  }

  pollCommands({ deviceId, limit } = {}) {
    this.assertEnabled();
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    const max = clampInteger(limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const nowIso = this.nowIso();
    const state = this.readState();
    let changed = this.expireCommandsInState(state, nowIso);
    const commands = [];
    for (const command of state.commands) {
      if (commands.length >= max) {
        break;
      }
      if (command.deviceId !== normalizedDeviceId || command.status !== "queued") {
        continue;
      }
      command.deliveryCount = Number(command.deliveryCount || 0) + 1;
      command.lastDeliveredAt = nowIso;
      command.updatedAt = nowIso;
      commands.push(clone(command));
      changed = true;
    }
    if (changed) {
      this.writeState(state);
    }
    return {
      deviceId: normalizedDeviceId,
      commands,
      now: nowIso,
    };
  }

  ackCommand({ deviceId, commandId, result = null } = {}) {
    return this.finishCommand({
      deviceId,
      commandId,
      status: "acked",
      result,
    });
  }

  failCommand({ deviceId, commandId, error = "", result = null } = {}) {
    return this.finishCommand({
      deviceId,
      commandId,
      status: "failed",
      error,
      result,
    });
  }

  getCommand(commandId) {
    const normalizedCommandId = normalizeText(commandId);
    const state = this.readState();
    this.expireCommandsInState(state, this.nowIso());
    const command = state.commands.find((candidate) => candidate.commandId === normalizedCommandId);
    return command ? clone(command) : null;
  }

  listCommands({ deviceId = "", status = "", commandId = "", limit } = {}) {
    const normalizedDeviceId = normalizeText(deviceId);
    const normalizedStatus = normalizeText(status);
    const normalizedCommandId = normalizeText(commandId);
    const max = clampInteger(limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const state = this.readState();
    const changed = this.expireCommandsInState(state, this.nowIso());
    if (changed) {
      this.writeState(state);
    }
    const commands = state.commands
      .filter((command) => !normalizedDeviceId || command.deviceId === normalizedDeviceId)
      .filter((command) => !normalizedStatus || command.status === normalizedStatus)
      .filter((command) => !normalizedCommandId || command.commandId === normalizedCommandId)
      .slice(-max)
      .reverse()
      .map(clone);
    return { commands };
  }

  finishCommand({ deviceId, commandId, status, error = "", result = null } = {}) {
    this.assertEnabled();
    const normalizedCommandId = normalizeText(commandId);
    if (!normalizedCommandId) {
      throw new Error("Android command id is required.");
    }
    const normalizedDeviceId = normalizeText(deviceId);
    const nowIso = this.nowIso();
    const state = this.readState();
    this.expireCommandsInState(state, nowIso);
    const command = state.commands.find((candidate) => candidate.commandId === normalizedCommandId);
    if (!command) {
      throw new Error(`Unknown Android command: ${normalizedCommandId}`);
    }
    if (normalizedDeviceId && command.deviceId !== normalizedDeviceId) {
      throw new Error(`Android command ${normalizedCommandId} does not belong to device ${normalizedDeviceId}.`);
    }
    if (command.status === status) {
      return clone(command);
    }
    if (!["queued", "expired"].includes(command.status)) {
      throw new Error(`Android command ${normalizedCommandId} is already ${command.status}.`);
    }
    command.status = status;
    command.updatedAt = nowIso;
    if (status === "acked") {
      command.ackedAt = nowIso;
      command.result = result && typeof result === "object" ? result : null;
    }
    if (status === "failed") {
      command.failedAt = nowIso;
      command.error = normalizeText(error);
      command.result = result && typeof result === "object" ? result : null;
    }
    this.writeState(state);
    return clone(command);
  }

  async notifyDevice(deviceId) {
    if (!this.pushSender || typeof this.pushSender.sendCommandAvailable !== "function") {
      return { sent: false, reason: "not_configured" };
    }
    const state = this.readState();
    const device = state.devices[this.normalizeDeviceId(deviceId)];
    if (!device?.fcmToken) {
      return { sent: false, reason: "missing_fcm_token" };
    }
    try {
      return await this.pushSender.sendCommandAvailable(device);
    } catch (error) {
      return {
        sent: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  expireCommandsInState(state, nowIso) {
    let changed = false;
    const nowMs = Date.parse(nowIso);
    for (const command of state.commands) {
      if (command.status !== "queued") {
        continue;
      }
      const expiresMs = Date.parse(command.expiresAt);
      if (Number.isFinite(expiresMs) && Number.isFinite(nowMs) && expiresMs <= nowMs) {
        command.status = "expired";
        command.updatedAt = nowIso;
        changed = true;
      }
    }
    return changed;
  }

  normalizeDeviceId(deviceId) {
    return normalizeText(deviceId) || this.defaultDeviceId;
  }

  assertEnabled() {
    if (!this.isEnabled()) {
      throw new Error("Android command bridge is disabled.");
    }
  }

  nowIso() {
    const value = this.now();
    return normalizeIsoTime(value) || new Date().toISOString();
  }

  readState() {
    if (!this.filePath || !fs.existsSync(this.filePath)) {
      return createEmptyState();
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return normalizeState(parsed);
    } catch {
      return createEmptyState();
    }
  }

  writeState(state) {
    if (!this.filePath) {
      throw new Error("Android command queue file is not configured.");
    }
    const normalized = normalizeState(state);
    const nowIso = this.nowIso();
    this.expireCommandsInState(normalized, nowIso);
    pruneRetainedCommands(normalized, nowIso);
    normalized.updatedAt = nowIso;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(normalized, null, 2));
  }
}

function createEmptyState() {
  return {
    updatedAt: "",
    devices: {},
    commands: [],
  };
}

function normalizeState(value) {
  return {
    updatedAt: normalizeText(value?.updatedAt),
    devices: value?.devices && typeof value.devices === "object" && !Array.isArray(value.devices)
      ? value.devices
      : {},
    commands: Array.isArray(value?.commands) ? value.commands : [],
  };
}

function pruneRetainedCommands(state, nowIso) {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return;
  const cutoff = nowMs - TERMINAL_COMMAND_RETENTION_MS;
  const active = [];
  const terminalByDevice = new Map();
  for (const command of state.commands) {
    if (!TERMINAL_COMMAND_STATES.has(normalizeText(command?.status))) {
      active.push(command);
      continue;
    }
    const timestamp = commandTimestamp(command);
    if (!timestamp || timestamp < cutoff) continue;
    const deviceId = normalizeText(command?.deviceId) || "unknown-device";
    const items = terminalByDevice.get(deviceId) || [];
    items.push(command);
    terminalByDevice.set(deviceId, items);
  }
  const retainedTerminal = [];
  for (const items of terminalByDevice.values()) {
    items.sort((left, right) => commandTimestamp(right) - commandTimestamp(left));
    retainedTerminal.push(...items.slice(0, MAX_TERMINAL_COMMANDS_PER_DEVICE));
  }
  state.commands = [...active, ...retainedTerminal]
    .sort((left, right) => commandTimestamp(left) - commandTimestamp(right));
}

function commandTimestamp(command) {
  const parsed = Date.parse(normalizeText(command?.updatedAt) || normalizeText(command?.createdAt));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function normalizeIsoTime(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function offsetIso(value, offsetMs) {
  const base = Date.parse(value);
  return new Date((Number.isFinite(base) ? base : Date.now()) + offsetMs).toISOString();
}

function clampInteger(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  AndroidCommandService,
};
