const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PROTOCOL_VERSION = 2;
const PAIRING_TTL_MS = 10 * 60_000;
const COMMAND_TTL_MS = 10 * 60_000;
const TERMINAL_COMMAND_RETENTION_MS = 30 * 24 * 60 * 60_000;
const PAIRING_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_TERMINAL_COMMANDS_PER_DEVICE = 1_000;
const TERMINAL_COMMAND_STATES = new Set(["succeeded", "failed", "denied", "expired", "cancelled"]);
const CAPABILITY_STATES = new Set(["ready", "needs_permission", "disabled", "unsupported"]);
const COMMAND_STATES = new Set([
  "queued",
  "delivered",
  "pending_user",
  "running",
  "succeeded",
  "failed",
  "denied",
  "expired",
  "cancelled",
]);
const POLICY_STATES = new Set(["pending_approval", "active", "paused", "rejected", "superseded"]);
const ENFORCEMENT_MODES = new Set(["observe", "remind", "block"]);

class AndroidDeviceService {
  constructor({ config = {}, now = () => new Date().toISOString(), randomBytes = crypto.randomBytes, pushSender = null } = {}) {
    this.config = config;
    this.now = now;
    this.randomBytes = randomBytes;
    this.pushSender = pushSender;
    this.filePath = normalizeText(config.androidV2StateFile) || path.join(normalizeText(config.stateDir) || ".", "android-edge-runtime-v2.json");
    this.defaultDeviceId = normalizeText(config.androidDefaultDeviceId) || "phone-main";
  }

  createPairing({ serverBaseUrl = "", deviceName = "" } = {}) {
    const baseUrl = normalizeServerBaseUrl(serverBaseUrl || this.config.androidPublicBaseUrl, {
      allowInsecure: Boolean(this.config.androidV2AllowInsecureHttp),
    });
    const state = this.readState();
    const now = this.nowIso();
    this.expireState(state, now);
    const pairingId = `pair_${this.randomHex(12)}`;
    const secret = this.randomToken(32);
    const pairing = {
      pairingId,
      secretHash: hashSecret(secret),
      serverBaseUrl: baseUrl,
      deviceName: normalizeText(deviceName),
      status: "pending",
      createdAt: now,
      expiresAt: offsetIso(now, PAIRING_TTL_MS),
      claimedAt: "",
      deviceId: "",
    };
    state.pairings.push(pairing);
    this.writeState(state);
    const query = new URLSearchParams({ server: baseUrl, pairingId, secret });
    return {
      pairingId,
      serverBaseUrl: baseUrl,
      expiresAt: pairing.expiresAt,
      pairingUri: `heart-anchor://pair?${query.toString()}`,
      secret,
    };
  }

  claimPairing({ pairingId, secret, deviceName = "", platform = "android", fcmToken = "", capabilities = [] } = {}) {
    const normalizedPairingId = requiredText(pairingId, "Pairing id is required.");
    const normalizedSecret = requiredText(secret, "Pairing secret is required.");
    const state = this.readState();
    const now = this.nowIso();
    this.expireState(state, now);
    const pairing = state.pairings.find((item) => item.pairingId === normalizedPairingId);
    if (!pairing || pairing.status === "expired") {
      throw new ServiceError(410, "Pairing session expired or does not exist.");
    }
    if (pairing.status !== "pending") {
      throw new ServiceError(409, "Pairing session has already been claimed.");
    }
    if (!safeHashEquals(pairing.secretHash, hashSecret(normalizedSecret))) {
      throw new ServiceError(401, "Pairing secret is invalid.");
    }
    const deviceId = this.nextDeviceId(state);
    const credential = this.randomToken(32);
    const device = {
      deviceId,
      deviceName: normalizeText(deviceName) || pairing.deviceName || "Android phone",
      platform: normalizeText(platform) || "android",
      credentialHash: hashSecret(credential),
      fcmToken: normalizeText(fcmToken),
      capabilities: normalizeCapabilities(capabilities),
      registeredAt: now,
      updatedAt: now,
      lastSeenAt: now,
      revokedAt: "",
      commandsPaused: false,
    };
    state.devices[deviceId] = device;
    pairing.status = "claimed";
    pairing.claimedAt = now;
    pairing.deviceId = deviceId;
    this.writeState(state);
    return {
      protocolVersion: PROTOCOL_VERSION,
      device: sanitizeDevice(device),
      credential,
      serverBaseUrl: pairing.serverBaseUrl,
    };
  }

  authenticateDevice({ deviceId, credential } = {}) {
    const normalizedDeviceId = requiredText(deviceId, "Device id is required.");
    const normalizedCredential = requiredText(credential, "Device credential is required.");
    const state = this.readState();
    const device = state.devices[normalizedDeviceId];
    if (!device || device.revokedAt || !safeHashEquals(device.credentialHash, hashSecret(normalizedCredential))) {
      throw new ServiceError(401, "Android device authentication failed.");
    }
    return sanitizeDevice(device);
  }

  heartbeat({ deviceId, credential, fcmToken = "", appVersion = "", osVersion = "" } = {}) {
    this.authenticateDevice({ deviceId, credential });
    const state = this.readState();
    const device = state.devices[deviceId];
    const now = this.nowIso();
    device.lastSeenAt = now;
    device.updatedAt = now;
    if (normalizeText(fcmToken)) device.fcmToken = normalizeText(fcmToken);
    if (normalizeText(appVersion)) device.appVersion = normalizeText(appVersion);
    if (normalizeText(osVersion)) device.osVersion = normalizeText(osVersion);
    this.writeState(state);
    return sanitizeDevice(device);
  }

  updateCapabilities({ deviceId, credential, capabilities } = {}) {
    this.authenticateDevice({ deviceId, credential });
    const state = this.readState();
    const device = state.devices[deviceId];
    device.capabilities = normalizeCapabilities(capabilities);
    device.lastSeenAt = this.nowIso();
    device.updatedAt = device.lastSeenAt;
    this.writeState(state);
    return sanitizeDevice(device);
  }

  listDevices() {
    const state = this.readState();
    return Object.values(state.devices).map(sanitizeDevice).sort((a, b) => Date.parse(b.lastSeenAt || 0) - Date.parse(a.lastSeenAt || 0));
  }

  getDevice(deviceId = "") {
    const state = this.readState();
    let normalized = normalizeText(deviceId);
    if (!normalized) {
      try {
        normalized = this.resolveDeviceId(state, "");
      } catch {
        return null;
      }
    }
    const device = state.devices[normalized];
    return device ? sanitizeDevice(device) : null;
  }

  revokeDevice(deviceId) {
    const normalized = requiredText(deviceId, "Device id is required.");
    const state = this.readState();
    const device = state.devices[normalized];
    if (!device) throw new ServiceError(404, `Unknown Android device: ${normalized}`);
    if (!device.revokedAt) {
      device.revokedAt = this.nowIso();
      device.updatedAt = device.revokedAt;
      device.fcmToken = "";
      this.writeState(state);
    }
    return sanitizeDevice(device);
  }

  setCommandsPaused(deviceId, paused) {
    const normalized = requiredText(deviceId, "Device id is required.");
    const state = this.readState();
    const device = state.devices[normalized];
    if (!device || device.revokedAt) throw new ServiceError(404, `Unknown Android device: ${normalized}`);
    device.commandsPaused = Boolean(paused);
    device.updatedAt = this.nowIso();
    this.writeState(state);
    return sanitizeDevice(device);
  }

  async enqueueAlarm({ deviceId = "", hour, minute, label = "", skipUi = true, expiresAt = "", createdBy = "mcp" } = {}) {
    const h = integerInRange(hour, 0, 23, "Alarm hour must be 0-23.");
    const m = integerInRange(minute, 0, 59, "Alarm minute must be 0-59.");
    return this.enqueueCommand({ deviceId, type: "alarm.set", riskLevel: "low", payload: { hour: h, minute: m, label: normalizeText(label), skipUi: skipUi !== false }, expiresAt, createdBy });
  }

  async enqueueTimer({ deviceId = "", durationSeconds, label = "", skipUi = true, expiresAt = "", createdBy = "mcp" } = {}) {
    const seconds = integerInRange(durationSeconds, 1, 86_400, "Timer durationSeconds must be 1-86400.");
    return this.enqueueCommand({ deviceId, type: "timer.set", riskLevel: "low", payload: { durationSeconds: seconds, label: normalizeText(label), skipUi: skipUi !== false }, expiresAt, createdBy });
  }

  async enqueueCommand({ commandId = "", deviceId = "", type, riskLevel = "low", payload = {}, expiresAt = "", createdBy = "mcp", policyId = "" } = {}) {
    const state = this.readState();
    const resolvedDeviceId = this.resolveDeviceId(state, deviceId);
    const device = state.devices[resolvedDeviceId];
    if (!device || device.revokedAt) throw new ServiceError(404, "No active paired Android device is available.");
    const id = normalizeText(commandId) || `cmd_${this.randomHex(16)}`;
    const existing = state.commands.find((item) => item.commandId === id);
    if (existing) return { ...sanitizeCommand(existing), duplicate: true };
    const now = this.nowIso();
    const command = {
      protocolVersion: PROTOCOL_VERSION,
      commandId: id,
      deviceId: resolvedDeviceId,
      type: requiredText(type, "Command type is required."),
      riskLevel: normalizeText(riskLevel) || "low",
      status: "queued",
      payload: isRecord(payload) ? clone(payload) : {},
      policyId: normalizeText(policyId),
      createdBy: normalizeText(createdBy) || "mcp",
      createdAt: now,
      updatedAt: now,
      deliveredAt: "",
      expiresAt: normalizeIso(expiresAt) || offsetIso(now, COMMAND_TTL_MS),
      result: null,
      error: "",
      deliveryCount: 0,
    };
    state.commands.push(command);
    this.writeState(state);
    await this.notifyDevice(device);
    return sanitizeCommand(command);
  }

  pollCommands({ deviceId, credential, limit = 20 } = {}) {
    this.authenticateDevice({ deviceId, credential });
    const state = this.readState();
    const device = state.devices[deviceId];
    const now = this.nowIso();
    this.expireState(state, now);
    if (device.commandsPaused) {
      device.lastSeenAt = now;
      this.writeState(state);
      return { protocolVersion: PROTOCOL_VERSION, deviceId, commandsPaused: true, commands: [], now };
    }
    const commands = state.commands
      .filter((item) => item.deviceId === deviceId && ["queued", "delivered"].includes(item.status))
      .slice(0, clampInteger(limit, 20, 1, 100));
    for (const command of commands) {
      command.status = "delivered";
      command.deliveredAt ||= now;
      command.updatedAt = now;
      command.deliveryCount = Number(command.deliveryCount || 0) + 1;
    }
    device.lastSeenAt = now;
    device.updatedAt = now;
    this.writeState(state);
    return { protocolVersion: PROTOCOL_VERSION, deviceId, commandsPaused: false, commands: commands.map(sanitizeCommand), now };
  }

  recordCommandResult({ deviceId, credential, commandId, status, result = null, error = "" } = {}) {
    this.authenticateDevice({ deviceId, credential });
    const normalizedStatus = normalizeText(status);
    if (!COMMAND_STATES.has(normalizedStatus) || ["queued", "delivered"].includes(normalizedStatus)) {
      throw new ServiceError(400, "Invalid Android v2 command result status.");
    }
    const state = this.readState();
    const command = state.commands.find((item) => item.commandId === commandId && item.deviceId === deviceId);
    if (!command) throw new ServiceError(404, `Unknown Android command: ${commandId}`);
    if (["succeeded", "failed", "denied", "expired", "cancelled"].includes(command.status)) {
      if (command.status !== normalizedStatus) throw new ServiceError(409, `Android command is already ${command.status}.`);
      command.result = isRecord(result) ? clone(result) : command.result;
      command.error = normalizeText(error) || command.error;
      if (command.policyId && command.type.startsWith("focus.policy.")) {
        this.applyPolicyResult(state, command, normalizedStatus, command.result);
      }
      this.writeState(state);
      return sanitizeCommand(command);
    }
    command.status = normalizedStatus;
    command.updatedAt = this.nowIso();
    command.result = isRecord(result) ? clone(result) : null;
    command.error = normalizeText(error);
    if (command.policyId && command.type.startsWith("focus.policy.")) {
      this.applyPolicyResult(state, command, normalizedStatus, command.result);
    }
    state.devices[deviceId].lastSeenAt = command.updatedAt;
    this.writeState(state);
    return sanitizeCommand(command);
  }

  listCommands({ deviceId = "", status = "", limit = 50 } = {}) {
    const state = this.readState();
    this.expireState(state, this.nowIso());
    return state.commands
      .filter((item) => !deviceId || item.deviceId === deviceId)
      .filter((item) => !status || item.status === status)
      .slice(-clampInteger(limit, 50, 1, 100))
      .reverse()
      .map(sanitizeCommand);
  }

  async createFocusPolicy(input = {}) {
    const state = this.readState();
    const deviceId = this.resolveDeviceId(state, input.deviceId);
    const policy = normalizeFocusPolicy(input, {
      policyId: `policy_${this.randomHex(12)}`,
      revision: 1,
      deviceId,
      now: this.nowIso(),
      state: "pending_approval",
    });
    state.policies.push(policy);
    this.writeState(state);
    await this.enqueueCommand({
      deviceId,
      type: "focus.policy.upsert",
      riskLevel: policy.enforcementMode === "block" ? "elevated" : "medium",
      payload: { policy: sanitizePolicy(policy) },
      policyId: policy.policyId,
      createdBy: normalizeText(input.createdBy) || "mcp",
      expiresAt: offsetIso(this.nowIso(), 7 * 24 * 60 * 60_000),
    });
    return sanitizePolicy(policy);
  }

  async updateFocusPolicy(input = {}) {
    const policyId = requiredText(input.policyId, "Policy id is required.");
    const state = this.readState();
    const existing = state.policies.find((item) => item.policyId === policyId);
    if (!existing) throw new ServiceError(404, `Unknown focus policy: ${policyId}`);
    const next = normalizeFocusPolicy({ ...existing, ...input }, {
      policyId,
      revision: Number(existing.revision || 0) + 1,
      deviceId: existing.deviceId,
      now: this.nowIso(),
      state: "pending_approval",
    });
    state.policies.push(next);
    this.writeState(state);
    await this.enqueueCommand({
      deviceId: next.deviceId,
      type: "focus.policy.upsert",
      riskLevel: next.enforcementMode === "block" ? "elevated" : "medium",
      payload: { policy: sanitizePolicy(next) },
      policyId,
      createdBy: normalizeText(input.createdBy) || "mcp",
      expiresAt: offsetIso(this.nowIso(), 7 * 24 * 60 * 60_000),
    });
    return sanitizePolicy(next);
  }

  async pauseFocusPolicy({ policyId, deviceId = "", createdBy = "mcp" } = {}) {
    const state = this.readState();
    const policy = latestPolicyRevision(state.policies, requiredText(policyId, "Policy id is required."));
    if (!policy) throw new ServiceError(404, `Unknown focus policy: ${policyId}`);
    if (deviceId && policy.deviceId !== deviceId) throw new ServiceError(400, "Focus policy belongs to a different device.");
    policy.state = "paused";
    policy.updatedAt = this.nowIso();
    this.writeState(state);
    await this.enqueueCommand({ deviceId: policy.deviceId, type: "focus.policy.pause", riskLevel: "low", payload: { policyId, revision: policy.revision }, policyId, createdBy });
    return sanitizePolicy(policy);
  }

  listFocusPolicies({ deviceId = "", state: policyState = "", includeHistory = false } = {}) {
    const state = this.readState();
    const items = includeHistory ? state.policies : latestPolicyRevisions(state.policies);
    return items
      .filter((item) => !deviceId || item.deviceId === deviceId)
      .filter((item) => !policyState || item.state === policyState)
      .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))
      .map(sanitizePolicy);
  }

  listDevicePolicies({ deviceId, credential } = {}) {
    this.authenticateDevice({ deviceId, credential });
    return this.listFocusPolicies({ deviceId });
  }

  applyPolicyResult(state, command, commandStatus, result) {
    const policy = state.policies
      .filter((item) => item.policyId === command.policyId)
      .sort((a, b) => Number(b.revision || 0) - Number(a.revision || 0))[0];
    if (!policy) return;
    const requestedState = normalizeText(result?.policyState);
    if (POLICY_STATES.has(requestedState)) {
      policy.state = requestedState;
    } else if (commandStatus === "succeeded" && command.type === "focus.policy.upsert") {
      policy.state = "active";
    } else if (commandStatus === "denied") {
      policy.state = "rejected";
    }
    policy.updatedAt = this.nowIso();
    if (policy.state === "active") {
      for (const previous of state.policies) {
        if (previous.policyId === policy.policyId && previous.revision !== policy.revision && previous.state === "active") {
          previous.state = "superseded";
          previous.updatedAt = policy.updatedAt;
        }
      }
    }
  }

  async notifyDevice(device) {
    if (!device?.fcmToken || !this.pushSender?.sendCommandAvailable) return { sent: false, reason: "missing_push" };
    try {
      return await this.pushSender.sendCommandAvailable(device);
    } catch (error) {
      return { sent: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  expireState(state, now) {
    const nowMs = Date.parse(now);
    for (const pairing of state.pairings) {
      if (pairing.status === "pending" && Date.parse(pairing.expiresAt) <= nowMs) pairing.status = "expired";
    }
    for (const command of state.commands) {
      if (["queued", "delivered", "pending_user", "running"].includes(command.status) && Date.parse(command.expiresAt) <= nowMs) {
        command.status = "expired";
        command.updatedAt = now;
      }
    }
  }

  resolveDeviceId(state, deviceId) {
    const requested = normalizeText(deviceId);
    if (requested) return requested;
    if (state.devices[this.defaultDeviceId] && !state.devices[this.defaultDeviceId].revokedAt) return this.defaultDeviceId;
    const active = Object.values(state.devices).filter((item) => !item.revokedAt).sort((a, b) => Date.parse(b.lastSeenAt || 0) - Date.parse(a.lastSeenAt || 0));
    if (!active.length) throw new ServiceError(404, "No active paired Android device is available.");
    return active[0].deviceId;
  }

  nextDeviceId(state) {
    const preferred = this.defaultDeviceId;
    if (!state.devices[preferred] || state.devices[preferred].revokedAt) return preferred;
    let candidate;
    do candidate = `android-${this.randomHex(4)}`; while (state.devices[candidate]);
    return candidate;
  }

  nowIso() {
    return normalizeIso(this.now()) || new Date().toISOString();
  }

  randomHex(bytes) {
    return this.randomBytes(bytes).toString("hex");
  }

  randomToken(bytes) {
    return this.randomBytes(bytes).toString("base64url");
  }

  readState() {
    try {
      return normalizeState(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
    } catch {
      return normalizeState({});
    }
  }

  writeState(state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const normalized = normalizeState(state);
    const now = this.nowIso();
    this.expireState(normalized, now);
    pruneRetainedState(normalized, now);
    normalized.updatedAt = now;
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(normalized, null, 2));
    fs.renameSync(temporary, this.filePath);
  }
}

class ServiceError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function normalizeState(value) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    updatedAt: normalizeText(value?.updatedAt),
    pairings: Array.isArray(value?.pairings) ? value.pairings : [],
    devices: isRecord(value?.devices) ? value.devices : {},
    commands: Array.isArray(value?.commands) ? value.commands : [],
    policies: Array.isArray(value?.policies) ? value.policies : [],
  };
}

function pruneRetainedState(state, now) {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return;
  const commandCutoff = nowMs - TERMINAL_COMMAND_RETENTION_MS;
  const pairingCutoff = nowMs - PAIRING_RETENTION_MS;

  const nonTerminal = [];
  const terminalByDevice = new Map();
  for (const command of state.commands) {
    if (!TERMINAL_COMMAND_STATES.has(normalizeText(command?.status))) {
      nonTerminal.push(command);
      continue;
    }
    const updatedMs = Date.parse(normalizeText(command?.updatedAt) || normalizeText(command?.createdAt));
    if (!Number.isFinite(updatedMs) || updatedMs < commandCutoff) continue;
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
  state.commands = [...nonTerminal, ...retainedTerminal]
    .sort((left, right) => commandTimestamp(left) - commandTimestamp(right));

  state.pairings = state.pairings.filter((pairing) => {
    if (pairing?.status === "pending") return true;
    const reference = normalizeText(pairing?.claimedAt) || normalizeText(pairing?.expiresAt) || normalizeText(pairing?.createdAt);
    const referenceMs = Date.parse(reference);
    return !Number.isFinite(referenceMs) || referenceMs >= pairingCutoff;
  });
}

function commandTimestamp(command) {
  const parsed = Date.parse(normalizeText(command?.updatedAt) || normalizeText(command?.createdAt));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Map();
  for (const item of value) {
    const key = normalizeText(item?.key);
    const status = normalizeText(item?.status);
    if (!key || !CAPABILITY_STATES.has(status)) continue;
    unique.set(key, { key, status, detail: normalizeText(item?.detail), updatedAt: normalizeText(item?.updatedAt) });
  }
  return [...unique.values()];
}

function normalizeFocusPolicy(value, defaults) {
  const packageNames = [...new Set((Array.isArray(value.packageNames) ? value.packageNames : []).map(normalizeText).filter(Boolean))];
  if (!packageNames.length) throw new ServiceError(400, "Focus policy requires at least one package name.");
  const dailyLimitMinutes = integerInRange(value.dailyLimitMinutes, 1, 1_440, "Focus policy dailyLimitMinutes must be 1-1440.");
  const enforcementMode = normalizeText(value.enforcementMode) || "remind";
  if (!ENFORCEMENT_MODES.has(enforcementMode)) throw new ServiceError(400, "Focus policy enforcementMode must be observe, remind, or block.");
  const daysOfWeek = [...new Set((Array.isArray(value.daysOfWeek) ? value.daysOfWeek : [1, 2, 3, 4, 5, 6, 7]).map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort();
  if (!daysOfWeek.length) throw new ServiceError(400, "Focus policy requires at least one day of week.");
  return {
    policyId: defaults.policyId,
    revision: defaults.revision,
    deviceId: defaults.deviceId,
    type: "app_usage_limit",
    title: normalizeText(value.title) || "应用使用限制",
    packageNames,
    daysOfWeek,
    startTime: normalizeClock(value.startTime, "00:00"),
    endTime: normalizeClock(value.endTime, "23:59"),
    timeZone: normalizeText(value.timeZone) || "Asia/Shanghai",
    dailyLimitMinutes,
    enforcementMode,
    warningThresholds: normalizeThresholds(value.warningThresholds, dailyLimitMinutes),
    temporaryUnlockMinutes: integerInRange(value.temporaryUnlockMinutes ?? 5, 1, 60, "Temporary unlock must be 1-60 minutes."),
    enabled: value.enabled !== false,
    state: defaults.state,
    createdAt: normalizeText(value.createdAt) || defaults.now,
    updatedAt: defaults.now,
  };
}

function normalizeThresholds(value, limit) {
  const defaults = [Math.max(1, Math.floor(limit * 0.8)), limit];
  return [...new Set((Array.isArray(value) ? value : defaults).map(Number).filter((item) => Number.isInteger(item) && item > 0 && item <= limit))].sort((a, b) => a - b);
}

function sanitizeDevice(device) {
  const { credentialHash, ...safe } = clone(device);
  return safe;
}

function sanitizeCommand(command) {
  return clone(command);
}

function sanitizePolicy(policy) {
  return clone(policy);
}

function latestPolicyRevision(policies, policyId) {
  return policies.filter((item) => item.policyId === policyId).sort((a, b) => Number(b.revision || 0) - Number(a.revision || 0))[0] || null;
}

function latestPolicyRevisions(policies) {
  const latest = new Map();
  for (const policy of policies) {
    const current = latest.get(policy.policyId);
    if (!current || Number(policy.revision || 0) > Number(current.revision || 0)) latest.set(policy.policyId, policy);
  }
  return [...latest.values()];
}

function normalizeServerBaseUrl(value, { allowInsecure }) {
  const text = requiredText(value, "Android public server base URL is required.");
  let parsed;
  try { parsed = new URL(text); } catch { throw new ServiceError(400, "Android public server base URL is invalid."); }
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(allowInsecure || loopback)) throw new ServiceError(400, "Android v2 pairing requires HTTPS.");
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function normalizeClock(value, fallback) {
  const text = normalizeText(value) || fallback;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new ServiceError(400, "Focus policy time must use HH:mm.");
  return text;
}

function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function safeHashEquals(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requiredText(value, message) {
  const text = normalizeText(value);
  if (!text) throw new ServiceError(400, message);
  return text;
}

function normalizeText(value) { return typeof value === "string" ? value.trim() : ""; }
function normalizeIso(value) { const time = Date.parse(normalizeText(value)); return Number.isFinite(time) ? new Date(time).toISOString() : ""; }
function offsetIso(value, offsetMs) { return new Date(Date.parse(value) + offsetMs).toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function clampInteger(value, fallback, min, max) { const parsed = Number(value); return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; }
function integerInRange(value, min, max, message) { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new ServiceError(400, message); return parsed; }

module.exports = {
  AndroidDeviceService,
  ServiceError,
  PROTOCOL_VERSION,
  CAPABILITY_STATES,
  COMMAND_STATES,
  POLICY_STATES,
};
