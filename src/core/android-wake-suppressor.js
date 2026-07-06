const DEFAULT_COOLDOWN_MS = 5 * 60_000;

const COOLDOWNS_BY_EVENT_TYPE = {
  place_transition: 10 * 60_000,
  battery_power: 60 * 60_000,
  device_unlock: 30 * 60_000,
  notification_received: 5 * 60_000,
  watch_sleep_summary: 6 * 60 * 60_000,
  watch_wake_up: 3 * 60 * 60_000,
  watch_bedtime: 3 * 60 * 60_000,
  watch_heart_rate_alert: 30 * 60_000,
  watch_sedentary_too_long: 2 * 60 * 60_000,
  watch_battery_low: 2 * 60 * 60_000,
};

class AndroidWakeSuppressor {
  constructor({ cooldownsByEventType = COOLDOWNS_BY_EVENT_TYPE, defaultCooldownMs = DEFAULT_COOLDOWN_MS } = {}) {
    this.cooldownsByEventType = { ...cooldownsByEventType };
    this.defaultCooldownMs = defaultCooldownMs;
    this.lastFiredAtByKey = new Map();
  }

  shouldFire(triggerKey, nowMs = Date.now()) {
    const key = normalizeKey(triggerKey);
    if (!key) {
      return false;
    }
    const last = this.lastFiredAtByKey.get(key) || 0;
    const cooldown = this.resolveCooldownMs(key);
    return nowMs - last >= cooldown;
  }

  markFired(triggerKey, nowMs = Date.now()) {
    const key = normalizeKey(triggerKey);
    if (!key) {
      return;
    }
    this.lastFiredAtByKey.set(key, nowMs);
  }

  resolveCooldownMs(triggerKey) {
    const [eventType] = String(triggerKey || "").split(":");
    const explicit = this.cooldownsByEventType[eventType];
    return Number.isFinite(explicit) && explicit >= 0 ? explicit : this.defaultCooldownMs;
  }
}

function deriveAndroidTriggerKey(event) {
  if (!event || typeof event !== "object") {
    return "";
  }
  const eventType = normalizeAndroidEventType(event.eventType);
  if (!eventType) {
    return "";
  }
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  switch (eventType) {
    case "place_transition": {
      const placeTag = normalizeText(payload.placeTag || payload.place || payload.locationTag) || "unknown";
      const transition = normalizeText(payload.transition || payload.state || payload.action) || "unknown";
      return `place_transition:${placeTag}:${transition}`;
    }
    case "battery_power":
      return `battery_power:low`;
    case "device_unlock":
      return `device_unlock:late_night`;
    case "notification_received": {
      const appKey = normalizeText(payload.appPackage || payload.appName) || "unknown";
      return `notification_received:${appKey}`;
    }
    case "watch_heart_rate_alert": {
      const alertKind = normalizeText(payload.alertKind || payload.kind || payload.state) || "alert";
      return `watch_heart_rate_alert:${alertKind}`;
    }
    case "watch_sedentary_too_long":
      return "watch_sedentary_too_long";
    case "watch_sleep_summary":
      return "watch_sleep_summary";
    case "watch_wake_up":
      return "watch_wake_up";
    case "watch_bedtime":
      return "watch_bedtime";
    case "watch_battery_low":
      return "watch_battery_low";
    default:
      return `${eventType}`;
  }
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

function normalizeKey(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  AndroidWakeSuppressor,
  deriveAndroidTriggerKey,
};
