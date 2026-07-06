const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { AndroidCommandService } = require("./android-command-service");

const DEFAULT_DUPLICATE_WINDOW_MS = 30_000;
const DEFAULT_MAX_REQUEST_BYTES = 256 * 1024;
const DEFAULT_SEEN_EVENT_LIMIT = 2000;

class AndroidIngestService {
  constructor({ config, commandService = null }) {
    this.config = config;
    this.commandService = commandService || new AndroidCommandService({ config });
    this.server = null;
    this.onAccepted = null;
  }

  async startServer({ onAccepted } = {}) {
    if (this.server) {
      return this.server;
    }
    const token = normalizeText(this.config.androidWebhookToken);
    if (!token) {
      throw new Error("CYBERBOSS_ANDROID_WEBHOOK_TOKEN is required when Android ingest is enabled.");
    }
    ensureParentDirectory(this.config.androidEventsFile);
    ensureParentDirectory(this.config.androidDevicesFile);
    this.onAccepted = typeof onAccepted === "function" ? onAccepted : null;
    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response).catch((error) => {
        sendJson(response, error instanceof RequestError ? error.statusCode : 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
    await new Promise((resolve, reject) => {
      this.server.on("error", reject);
      this.server.listen(this.config.androidWebhookPort, this.config.androidWebhookHost, resolve);
    });
    return this.server;
  }

  async closeServer() {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = null;
    this.onAccepted = null;
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async handleRequest(request, response) {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/readyz") {
      sendJson(response, 200, {
        ok: true,
        service: "android-ingest",
        now: new Date().toISOString(),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/android/events") {
      this.assertAuthorized(request);
      const body = await readJsonBody(request);
      const result = this.acceptEvent(body, {
        remoteAddress: normalizeText(request.socket?.remoteAddress),
      });
      sendJson(response, 200, {
        ok: true,
        duplicate: result.duplicate,
        eventId: result.event.eventId,
        receivedAt: result.event.receivedAt,
        summary: result.event.summary,
      });
      if (!result.duplicate && this.onAccepted) {
        Promise.resolve(this.onAccepted(result)).catch((error) => {
          const message = error instanceof Error ? error.stack || error.message : String(error);
          console.error(`[heart-anchor] android ingest callback failed ${message}`);
        });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/android/devices/register") {
      this.assertAuthorized(request);
      const body = await readJsonBody(request);
      const device = this.commandService.registerDevice(body);
      sendJson(response, 200, {
        ok: true,
        device,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/android/fcm-token") {
      this.assertAuthorized(request);
      const body = await readJsonBody(request);
      const device = this.commandService.updateFcmToken(body);
      sendJson(response, 200, {
        ok: true,
        device,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/android/commands") {
      this.assertAuthorized(request);
      const result = this.commandService.pollCommands({
        deviceId: url.searchParams.get("deviceId") || "",
        limit: url.searchParams.get("limit") || "",
      });
      sendJson(response, 200, {
        ok: true,
        ...result,
      });
      return;
    }
    const commandAckMatch = url.pathname.match(/^\/api\/android\/commands\/([^/]+)\/ack$/);
    if (request.method === "POST" && commandAckMatch) {
      this.assertAuthorized(request);
      const body = await readJsonBody(request);
      const command = this.commandService.ackCommand({
        commandId: decodeURIComponent(commandAckMatch[1]),
        deviceId: normalizeText(body.deviceId),
        result: body.result && typeof body.result === "object" ? body.result : null,
      });
      sendJson(response, 200, {
        ok: true,
        command,
      });
      return;
    }
    const commandFailMatch = url.pathname.match(/^\/api\/android\/commands\/([^/]+)\/fail$/);
    if (request.method === "POST" && commandFailMatch) {
      this.assertAuthorized(request);
      const body = await readJsonBody(request);
      const command = this.commandService.failCommand({
        commandId: decodeURIComponent(commandFailMatch[1]),
        deviceId: normalizeText(body.deviceId),
        error: normalizeText(body.error),
        result: body.result && typeof body.result === "object" ? body.result : null,
      });
      sendJson(response, 200, {
        ok: true,
        command,
      });
      return;
    }
    sendJson(response, 404, { ok: false, error: "Not found" });
  }

  assertAuthorized(request) {
    const expected = normalizeText(this.config.androidWebhookToken);
    const provided = extractBearerToken(request.headers?.authorization);
    if (!expected || !provided || provided !== expected) {
      throw new RequestError(401, "Unauthorized Android webhook request.");
    }
  }

  acceptEvent(payload, context = {}) {
    const event = normalizeAndroidEvent(payload, context);
    const deviceState = readJsonFile(this.config.androidDevicesFile, createEmptyDeviceState());
    const existingDevice = deviceState.devices[event.deviceId] || createEmptyDeviceEntry(event.deviceId);
    const duplicate = isDuplicateEvent({
      event,
      device: existingDevice,
      seenEventIds: deviceState.seenEventIds,
    });
    const nextDevice = {
      ...existingDevice,
      deviceId: event.deviceId,
      lastSeenAt: event.receivedAt,
      lastEventAt: event.occurredAt,
      lastEventType: event.eventType,
      lastSummary: event.summary,
      updatedAt: event.receivedAt,
      lastEventFingerprint: event.fingerprint,
      lastEventFingerprintAt: event.occurredAt,
      acceptedCount: Number(existingDevice.acceptedCount || 0) + (duplicate ? 0 : 1),
      duplicateCount: Number(existingDevice.duplicateCount || 0) + (duplicate ? 1 : 0),
      lastDuplicateAt: duplicate ? event.receivedAt : normalizeText(existingDevice.lastDuplicateAt),
    };
    const nextState = {
      updatedAt: event.receivedAt,
      seenEventIds: pruneSeenEventIds({
        ...deviceState.seenEventIds,
        [event.eventId]: event.receivedAt,
      }),
      devices: {
        ...deviceState.devices,
        [event.deviceId]: nextDevice,
      },
    };
    if (!duplicate) {
      appendJsonLine(this.config.androidEventsFile, event);
    }
    writeJsonFile(this.config.androidDevicesFile, nextState);
    return {
      duplicate,
      event,
      device: nextDevice,
    };
  }
}

function normalizeAndroidEvent(payload, context = {}) {
  if (!payload || typeof payload !== "object") {
    throw new RequestError(400, "Android event payload must be a JSON object.");
  }
  const deviceId = normalizeText(payload.deviceId);
  const eventType = normalizeText(payload.eventType);
  const eventId = normalizeText(payload.eventId) || crypto.randomUUID();
  const occurredAt = normalizeIsoTime(payload.occurredAt);
  if (!deviceId) {
    throw new RequestError(400, "Android event requires deviceId.");
  }
  if (!eventType) {
    throw new RequestError(400, "Android event requires eventType.");
  }
  if (!occurredAt) {
    throw new RequestError(400, "Android event requires a valid occurredAt timestamp.");
  }
  const payloadData = payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
    ? payload.payload
    : {};
  const receivedAt = new Date().toISOString();
  const summary = summarizeAndroidEvent({ eventType, payload: payloadData });
  const fingerprint = hashFingerprint({
    deviceId,
    eventType,
    payload: payloadData,
  });
  return {
    id: crypto.randomUUID(),
    source: "android-webhook",
    eventId,
    deviceId,
    eventType,
    occurredAt,
    receivedAt,
    remoteAddress: normalizeText(context.remoteAddress),
    payload: payloadData,
    summary,
    fingerprint,
  };
}

function summarizeAndroidEvent({ eventType, payload }) {
  switch (normalizeAndroidEventType(eventType)) {
    case "foreground_app":
      return `foreground ${normalizeText(payload.appName) || normalizeText(payload.appPackage) || "(unknown app)"}`;
    case "device_unlock":
      return `device ${normalizeText(payload.state) || "unlock"}`;
    case "notification_received":
      return `notification ${normalizeText(payload.appName) || normalizeText(payload.appPackage) || "(unknown app)"}`;
    case "battery_power":
      return `battery ${normalizeText(payload.state) || normalizeText(payload.level) || "(update)"}`;
    case "place_transition":
      return `place ${normalizeText(payload.transition) || normalizeText(payload.placeTag) || "(transition)"}`;
    case "watch_sleep_summary":
      return summarizeWatchSleepSummary(payload);
    case "watch_wake_up":
      return "watch wake up";
    case "watch_bedtime":
      return "watch bedtime";
    case "watch_heart_rate_alert":
      return summarizeWatchHeartRateAlert(payload);
    case "watch_sedentary_too_long":
      return summarizeWatchSedentaryTooLong(payload);
    case "watch_battery_low":
      return summarizeWatchBatteryLow(payload);
    default:
      return `${eventType} from ${normalizeText(payload.appName) || normalizeText(payload.appPackage) || normalizeText(payload.label) || "android"}`;
  }
}

function summarizeWatchSleepSummary(payload) {
  const totalSleepMinutes = normalizeInteger(payload.totalSleepMinutes ?? payload.sleepMinutes ?? payload.durationMinutes);
  const sleepScore = normalizeInteger(payload.sleepScore ?? payload.score);
  const poorSleep = normalizeBoolean(payload.isPoorSleep)
    || (Number.isInteger(totalSleepMinutes) && totalSleepMinutes <= 360)
    || (Number.isInteger(sleepScore) && sleepScore <= 60);
  const parts = [
    "watch sleep",
    poorSleep ? "poor" : "",
    formatMinutesCompact(totalSleepMinutes),
    Number.isInteger(sleepScore) ? `score ${sleepScore}` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

function summarizeWatchHeartRateAlert(payload) {
  const alertKind = normalizeText(payload.alertKind || payload.kind || payload.state) || "alert";
  const bpm = normalizeInteger(payload.bpm ?? payload.heartRate ?? payload.heartRateBpm);
  return [
    "watch heart rate",
    alertKind,
    Number.isInteger(bpm) ? `${bpm} bpm` : "",
  ].filter(Boolean).join(" ");
}

function summarizeWatchSedentaryTooLong(payload) {
  const sedentaryMinutes = normalizeInteger(payload.sedentaryMinutes ?? payload.inactiveMinutes ?? payload.durationMinutes);
  return [
    "watch sedentary",
    Number.isInteger(sedentaryMinutes) ? formatMinutesCompact(sedentaryMinutes) : "too long",
  ].filter(Boolean).join(" ");
}

function summarizeWatchBatteryLow(payload) {
  const level = normalizeInteger(payload.level ?? payload.batteryLevel);
  return `watch battery ${Number.isInteger(level) ? `${level}%` : "low"}`;
}

function normalizeAndroidEventType(eventType) {
  const normalized = normalizeText(eventType);
  switch (normalized) {
    case "sleep_summary":
    case "watch_sleep_summary":
      return "watch_sleep_summary";
    case "wake_up":
    case "watch_wake_up":
      return "watch_wake_up";
    case "bedtime":
    case "watch_bedtime":
      return "watch_bedtime";
    case "heart_rate_alert":
    case "watch_heart_rate_alert":
      return "watch_heart_rate_alert";
    case "sedentary_too_long":
    case "watch_sedentary_too_long":
      return "watch_sedentary_too_long";
    case "battery_low":
    case "watch_battery_low":
      return "watch_battery_low";
    default:
      return normalized;
  }
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "1"
    || normalized === "true"
    || normalized === "yes"
    || normalized === "on";
}

function normalizeInteger(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  const normalized = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(normalized) ? normalized : null;
}

function formatMinutesCompact(minutes) {
  const normalized = normalizeInteger(minutes);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return "";
  }
  const hours = Math.floor(normalized / 60);
  const remainder = normalized % 60;
  if (hours <= 0) {
    return `${normalized}m`;
  }
  if (remainder === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainder}m`;
}

function isDuplicateEvent({ event, device, seenEventIds }) {
  if (seenEventIds && typeof seenEventIds === "object" && normalizeText(seenEventIds[event.eventId])) {
    return true;
  }
  const lastFingerprint = normalizeText(device?.lastEventFingerprint);
  const lastFingerprintAt = normalizeIsoTime(device?.lastEventFingerprintAt);
  if (!lastFingerprint || !lastFingerprintAt || lastFingerprint !== event.fingerprint) {
    return false;
  }
  const delta = Math.abs(Date.parse(event.occurredAt) - Date.parse(lastFingerprintAt));
  return Number.isFinite(delta) && delta <= DEFAULT_DUPLICATE_WINDOW_MS;
}

function pruneSeenEventIds(map) {
  const entries = Object.entries(map || {})
    .filter(([, timestamp]) => normalizeIsoTime(timestamp))
    .sort((left, right) => Date.parse(right[1]) - Date.parse(left[1]))
    .slice(0, DEFAULT_SEEN_EVENT_LIMIT);
  return Object.fromEntries(entries);
}

function createEmptyDeviceState() {
  return {
    updatedAt: "",
    seenEventIds: {},
    devices: {},
  };
}

function createEmptyDeviceEntry(deviceId) {
  return {
    deviceId,
    lastSeenAt: "",
    lastEventAt: "",
    lastEventType: "",
    lastSummary: "",
    lastDuplicateAt: "",
    lastEventFingerprint: "",
    lastEventFingerprintAt: "",
    acceptedCount: 0,
    duplicateCount: 0,
    updatedAt: "",
  };
}

function extractBearerToken(headerValue) {
  const header = normalizeText(headerValue);
  if (!header.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return header.slice(7).trim();
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > DEFAULT_MAX_REQUEST_BYTES) {
        reject(new RequestError(413, "Android event payload is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(new RequestError(400, error instanceof Error ? error.message : "Invalid JSON payload."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function appendJsonLine(filePath, value) {
  ensureParentDirectory(filePath);
  fs.appendFileSync(filePath, JSON.stringify(value) + "\n", "utf8");
}

function writeJsonFile(filePath, value) {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIsoTime(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function hashFingerprint(value) {
  return crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

class RequestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

module.exports = { AndroidIngestService };
