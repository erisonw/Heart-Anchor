const {
  normalizeText,
  normalizeBoolean,
  normalizeInteger,
  normalizeIsoTime,
  offsetIsoTime,
  hashLite,
  formatCompactNumber,
} = require("./values");

function buildLocationMovementSystemText(event) {
  const distanceText = `${formatCompactNumber(event?.distanceMeters || 0)}m`;
  const fromLabel = normalizeText(event?.fromAddress) || formatLatLng(event?.fromCenterLat, event?.fromCenterLng);
  const toLabel = normalizeText(event?.toAddress) || formatLatLng(event?.toCenterLat, event?.toCenterLng);
  const movedAt = normalizeText(event?.movedAt) || new Date().toISOString();
  return [
    "System context: the user's location appears to have changed significantly.",
    `Distance: about ${distanceText}.`,
    fromLabel ? `From: ${fromLabel}` : "",
    toLabel ? `To: ${toLabel}` : "",
    `Observed at: ${movedAt}.`,
  ].filter(Boolean).join("\n");
}

function buildLocationTriggerSystemText(trigger) {
  switch (normalizeText(trigger)) {
    case "arrive_home":
      return "User arrives home.";
    case "leave_home":
      return "User leaves home.";
    default:
      return "";
  }
}

function buildAndroidTriggerSystemText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }
  const eventType = normalizeAndroidEventType(event.eventType);
  const deviceId = normalizeText(event.deviceId) || "android-device";
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  switch (eventType) {
    case "place_transition":
      return buildAndroidPlaceTriggerText({ event, payload, deviceId });
    case "battery_power":
      return buildAndroidBatteryTriggerText({ event, payload, deviceId });
    case "device_unlock":
      return buildAndroidUnlockTriggerText({ event, payload, deviceId });
    case "notification_received":
      return buildAndroidNotificationTriggerText({ event, payload, deviceId });
    case "watch_sleep_summary":
      return buildWatchSleepTriggerText({ event, payload, deviceId });
    case "watch_wake_up":
      return buildWatchWakeUpTriggerText({ event, deviceId });
    case "watch_bedtime":
      return buildWatchBedtimeTriggerText({ event, deviceId });
    case "watch_heart_rate_alert":
      return buildWatchHeartRateTriggerText({ event, payload, deviceId });
    case "watch_sedentary_too_long":
      return buildWatchSedentaryTriggerText({ event, payload, deviceId });
    case "watch_battery_low":
      return buildWatchBatteryLowTriggerText({ event, payload, deviceId });
    default:
      return "";
  }
}

function buildAndroidPlaceTriggerText({ event, payload, deviceId }) {
  const placeTag = normalizeText(payload.placeTag || payload.place || payload.locationTag);
  const transition = normalizeText(payload.transition || payload.state || payload.action);
  if (!placeTag && !transition) {
    return "";
  }
  return [
    "An Android place transition event arrived from the phone.",
    `Device: ${deviceId}`,
    `Transition: ${transition || "(unknown)"}`,
    `Place: ${placeTag || "(unknown)"}`,
    `Occurred at: ${normalizeIsoTime(event.occurredAt) || "(unknown)"}`,
    "Treat this as fresh real-world context. If it matters, respond naturally and briefly in the current WeChat chat.",
  ].join("\n");
}

function buildAndroidBatteryTriggerText({ event, payload, deviceId }) {
  const state = normalizeText(payload.state || payload.batteryState);
  const levelValue = payload.level ?? payload.batteryLevel;
  const level = normalizeInteger(levelValue);
  const isLow = normalizeBoolean(payload.isLowBattery)
    || state === "low_battery"
    || state === "critical_battery"
    || (Number.isInteger(level) && level <= 20);
  if (!isLow) {
    return "";
  }
  return [
    "A notable Android battery event arrived from the phone.",
    `Device: ${deviceId}`,
    `State: ${state || "(unknown)"}`,
    `Level: ${Number.isInteger(level) ? `${level}%` : "(unknown)"}`,
    `Occurred at: ${normalizeIsoTime(event.occurredAt) || "(unknown)"}`,
    "Only react if this seems meaningfully relevant right now. Keep the message short and practical.",
  ].join("\n");
}

function buildAndroidUnlockTriggerText({ event, payload, deviceId }) {
  const streak = normalizeInteger(payload.nightUnlockStreak ?? payload.unlockStreak ?? payload.streak);
  const hour = normalizeInteger(payload.localHour ?? payload.hour);
  const isLateNight = normalizeBoolean(payload.isLateNight)
    || normalizeBoolean(payload.lateNight)
    || (Number.isInteger(hour) && hour >= 0 && hour <= 5);
  if (!isLateNight || !Number.isInteger(streak) || streak < 3) {
    return "";
  }
  return [
    "A late-night Android unlock pattern was detected.",
    `Device: ${deviceId}`,
    `Night unlock streak: ${streak}`,
    `Local hour: ${Number.isInteger(hour) ? hour : "(unknown)"}`,
    `Occurred at: ${normalizeIsoTime(event.occurredAt) || "(unknown)"}`,
    "Treat this as a gentle wellbeing signal. If you reply, keep it warm, quiet, and non-intrusive.",
  ].join("\n");
}

function buildAndroidNotificationTriggerText({ event, payload, deviceId }) {
  const important = normalizeBoolean(payload.isImportant) || normalizeBoolean(payload.important);
  if (!important) {
    return "";
  }
  const appName = normalizeText(payload.appName || payload.appPackage);
  const title = normalizeText(payload.title);
  return [
    "An important Android notification event arrived from the phone.",
    `Device: ${deviceId}`,
    `App: ${appName || "(unknown)"}`,
    `Title: ${title || "(unknown)"}`,
    `Occurred at: ${normalizeIsoTime(event.occurredAt) || "(unknown)"}`,
    "Use this only as context. Respond only if it is genuinely useful in the current conversation.",
  ].join("\n");
}

function buildWatchSleepTriggerText({ event, payload, deviceId }) {
  const totalSleepMinutes = normalizeInteger(payload.totalSleepMinutes ?? payload.sleepMinutes ?? payload.durationMinutes);
  const sleepScore = normalizeInteger(payload.sleepScore ?? payload.score);
  if (!isWatchSleepPoor(payload)) {
    return "";
  }
  return [
    "A smartwatch sleep summary suggests the user may be under-rested.",
    `Device: ${deviceId}`,
    `Sleep: ${formatWatchMinutesCompact(totalSleepMinutes) || "(unknown)"}`,
    `Score: ${Number.isInteger(sleepScore) ? sleepScore : "(unknown)"}`,
    `Occurred at: ${normalizeIsoTime(event.occurredAt) || "(unknown)"}`,
    "Treat this as a gentle wellbeing signal. If you reply, keep it short, warm, and practical.",
  ].join("\n");
}

function buildWatchWakeUpTriggerText({ event, deviceId }) {
  return [
    "A smartwatch wake-up event suggests the user just got up.",
    `Device: ${deviceId}`,
    `Occurred at: ${normalizeIsoTime(event.occurredAt) || "(unknown)"}`,
    "Use this as fresh morning context. If you reply, keep it short and natural.",
  ].join("\n");
}

function buildWatchBedtimeTriggerText({ event, deviceId }) {
  return [
    "A smartwatch bedtime event suggests the user may be settling down to sleep.",
    `Device: ${deviceId}`,
    `Occurred at: ${normalizeIsoTime(event.occurredAt) || "(unknown)"}`,
    "If you reply, keep it quiet, brief, and sleep-friendly.",
  ].join("\n");
}

function buildWatchHeartRateTriggerText({ event, payload, deviceId }) {
  const alertKind = normalizeText(payload.alertKind || payload.kind || payload.state) || "(unknown)";
  const bpm = normalizeInteger(payload.bpm ?? payload.heartRate ?? payload.heartRateBpm);
  return [
    "A smartwatch heart-rate alert arrived.",
    `Device: ${deviceId}`,
    `Alert: ${alertKind}`,
    `Heart rate: ${Number.isInteger(bpm) ? `${bpm} bpm` : "(unknown)"}`,
    `Occurred at: ${normalizeIsoTime(event.occurredAt) || "(unknown)"}`,
    "Only react if it is meaningfully relevant right now. Keep the message calm and concise.",
  ].join("\n");
}

function buildWatchSedentaryTriggerText({ event, payload, deviceId }) {
  const sedentaryMinutes = normalizeInteger(payload.sedentaryMinutes ?? payload.inactiveMinutes ?? payload.durationMinutes);
  return [
    "A smartwatch inactivity alert arrived.",
    `Device: ${deviceId}`,
    `Inactive for: ${formatWatchMinutesCompact(sedentaryMinutes) || "(unknown)"}`,
    `Occurred at: ${normalizeIsoTime(event.occurredAt) || "(unknown)"}`,
    "Use this only as a gentle movement reminder if it feels genuinely helpful.",
  ].join("\n");
}

function buildWatchBatteryLowTriggerText({ event, payload, deviceId }) {
  const level = normalizeInteger(payload.level ?? payload.batteryLevel);
  return [
    "A smartwatch low-battery event arrived.",
    `Device: ${deviceId}`,
    `Battery: ${Number.isInteger(level) ? `${level}%` : "(unknown)"}`,
    `Occurred at: ${normalizeIsoTime(event.occurredAt) || "(unknown)"}`,
    "Only mention this if it seems practically useful right now.",
  ].join("\n");
}

function buildAndroidTimelineWrite(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  const occurredAt = normalizeIsoTime(event.occurredAt) || normalizeIsoTime(event.receivedAt);
  if (!occurredAt) {
    return null;
  }
  const timelineEvent = buildAndroidTimelineEvent(event, occurredAt);
  if (!timelineEvent) {
    return null;
  }
  const localDate = formatShanghaiDate(occurredAt);
  if (!localDate) {
    return null;
  }
  return {
    date: localDate,
    mode: "merge",
    events: [timelineEvent],
  };
}

function buildAndroidTimelineEvent(event, occurredAt) {
  const eventType = normalizeAndroidEventType(event.eventType);
  const deviceId = normalizeText(event.deviceId) || "android-device";
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  const base = {
    id: `android:${normalizeText(event.eventId) || normalizeText(event.id) || hashLite(occurredAt + eventType + deviceId)}`,
    startAt: occurredAt,
    endAt: offsetIsoTime(occurredAt, 60),
    description: normalizeText(event.summary),
    tags: ["android", eventType, deviceId].filter(Boolean),
  };
  switch (eventType) {
    case "place_transition":
      return buildAndroidPlaceTimelineEvent(base, payload);
    case "battery_power":
      return buildAndroidBatteryTimelineEvent(base, payload);
    case "device_unlock":
      return buildAndroidUnlockTimelineEvent(base, payload);
    case "notification_received":
      return buildAndroidNotificationTimelineEvent(base, payload);
    case "watch_sleep_summary":
      return buildWatchSleepTimelineEvent(base, payload);
    case "watch_wake_up":
      return buildWatchWakeUpTimelineEvent(base);
    case "watch_bedtime":
      return buildWatchBedtimeTimelineEvent(base);
    case "watch_heart_rate_alert":
      return buildWatchHeartRateTimelineEvent(base, payload);
    case "watch_sedentary_too_long":
      return buildWatchSedentaryTimelineEvent(base, payload);
    case "watch_battery_low":
      return buildWatchBatteryLowTimelineEvent(base, payload);
    default:
      return null;
  }
}

function buildAndroidPlaceTimelineEvent(base, payload) {
  const placeTag = normalizeText(payload.placeTag || payload.place || payload.locationTag);
  const transition = normalizeText(payload.transition || payload.state || payload.action);
  if (!placeTag && !transition) {
    return null;
  }
  return {
    ...base,
    categoryId: "travel",
    subcategoryId: "travel.other",
    title: `Android place ${transition || "update"}${placeTag ? `: ${placeTag}` : ""}`,
    note: [
      placeTag ? `place=${placeTag}` : "",
      transition ? `transition=${transition}` : "",
    ].filter(Boolean).join(" "),
    tags: [...base.tags, "place-transition", placeTag, transition].filter(Boolean),
  };
}

function buildAndroidBatteryTimelineEvent(base, payload) {
  const state = normalizeText(payload.state || payload.batteryState);
  const level = normalizeInteger(payload.level ?? payload.batteryLevel);
  const isLow = normalizeBoolean(payload.isLowBattery)
    || state === "low_battery"
    || state === "critical_battery"
    || (Number.isInteger(level) && level <= 20);
  if (!isLow) {
    return null;
  }
  return {
    ...base,
    categoryId: "health",
    subcategoryId: "health.other",
    title: `Android battery low${Number.isInteger(level) ? `: ${level}%` : ""}`,
    note: state ? `state=${state}` : "",
    tags: [...base.tags, "battery-low", state].filter(Boolean),
  };
}

function buildAndroidUnlockTimelineEvent(base, payload) {
  const streak = normalizeInteger(payload.nightUnlockStreak ?? payload.unlockStreak ?? payload.streak);
  const hour = normalizeInteger(payload.localHour ?? payload.hour);
  const isLateNight = normalizeBoolean(payload.isLateNight)
    || normalizeBoolean(payload.lateNight)
    || (Number.isInteger(hour) && hour >= 0 && hour <= 5);
  if (!isLateNight || !Number.isInteger(streak) || streak < 3) {
    return null;
  }
  return {
    ...base,
    categoryId: "rest",
    subcategoryId: "rest.other",
    title: `Android late-night unlock streak: ${streak}`,
    note: Number.isInteger(hour) ? `hour=${hour}` : "",
    tags: [...base.tags, "late-night", "unlock-streak"].filter(Boolean),
  };
}

function buildAndroidNotificationTimelineEvent(base, payload) {
  const important = normalizeBoolean(payload.isImportant) || normalizeBoolean(payload.important);
  if (!important) {
    return null;
  }
  const appName = normalizeText(payload.appName || payload.appPackage);
  const title = normalizeText(payload.title);
  return {
    ...base,
    categoryId: "life",
    subcategoryId: "life.other",
    title: `Android important notification${appName ? `: ${appName}` : ""}`,
    note: title || "",
    tags: [...base.tags, "important-notification", appName].filter(Boolean),
  };
}

function buildWatchSleepTimelineEvent(base, payload) {
  const totalSleepMinutes = normalizeInteger(payload.totalSleepMinutes ?? payload.sleepMinutes ?? payload.durationMinutes);
  const sleepScore = normalizeInteger(payload.sleepScore ?? payload.score);
  return {
    ...base,
    categoryId: "rest",
    subcategoryId: "rest.sleep",
    eventNodeId: "evt.sleep",
    title: `Watch sleep summary: ${formatWatchMinutesCompact(totalSleepMinutes) || "unknown"}`,
    note: [
      Number.isInteger(sleepScore) ? `score=${sleepScore}` : "",
      isWatchSleepPoor(payload) ? "poorSleep=true" : "",
    ].filter(Boolean).join(" "),
    tags: [...base.tags, "watch", "sleep-summary", isWatchSleepPoor(payload) ? "poor-sleep" : ""].filter(Boolean),
  };
}

function buildWatchWakeUpTimelineEvent(base) {
  return {
    ...base,
    categoryId: "rest",
    subcategoryId: "rest.sleep",
    title: "Watch wake-up",
    tags: [...base.tags, "watch", "wake-up"].filter(Boolean),
  };
}

function buildWatchBedtimeTimelineEvent(base) {
  return {
    ...base,
    categoryId: "rest",
    subcategoryId: "rest.sleep",
    title: "Watch bedtime",
    tags: [...base.tags, "watch", "bedtime"].filter(Boolean),
  };
}

function buildWatchHeartRateTimelineEvent(base, payload) {
  const alertKind = normalizeText(payload.alertKind || payload.kind || payload.state);
  const bpm = normalizeInteger(payload.bpm ?? payload.heartRate ?? payload.heartRateBpm);
  return {
    ...base,
    categoryId: "health",
    subcategoryId: "health.other",
    title: `Watch heart rate alert${Number.isInteger(bpm) ? `: ${bpm} bpm` : ""}`,
    note: alertKind ? `kind=${alertKind}` : "",
    tags: [...base.tags, "watch", "heart-rate-alert", alertKind].filter(Boolean),
  };
}

function buildWatchSedentaryTimelineEvent(base, payload) {
  const sedentaryMinutes = normalizeInteger(payload.sedentaryMinutes ?? payload.inactiveMinutes ?? payload.durationMinutes);
  return {
    ...base,
    categoryId: "health",
    subcategoryId: "health.other",
    title: `Watch sedentary too long${formatWatchMinutesCompact(sedentaryMinutes) ? `: ${formatWatchMinutesCompact(sedentaryMinutes)}` : ""}`,
    tags: [...base.tags, "watch", "sedentary"].filter(Boolean),
  };
}

function buildWatchBatteryLowTimelineEvent(base, payload) {
  const level = normalizeInteger(payload.level ?? payload.batteryLevel);
  return {
    ...base,
    categoryId: "health",
    subcategoryId: "health.other",
    title: `Watch battery low${Number.isInteger(level) ? `: ${level}%` : ""}`,
    tags: [...base.tags, "watch", "battery-low"].filter(Boolean),
  };
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

function isWatchSleepPoor(payload) {
  const totalSleepMinutes = normalizeInteger(payload.totalSleepMinutes ?? payload.sleepMinutes ?? payload.durationMinutes);
  const sleepScore = normalizeInteger(payload.sleepScore ?? payload.score);
  return normalizeBoolean(payload.isPoorSleep)
    || (Number.isInteger(totalSleepMinutes) && totalSleepMinutes <= 360)
    || (Number.isInteger(sleepScore) && sleepScore <= 60);
}

function formatWatchMinutesCompact(minutes) {
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

function formatShanghaiDate(value) {
  const normalized = normalizeIsoTime(value);
  if (!normalized) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(normalized)).replace(/\//g, "-");
}

function formatLatLng(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "";
  }
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

module.exports = {
  buildLocationMovementSystemText,
  buildLocationTriggerSystemText,
  buildAndroidTriggerSystemText,
  buildAndroidTimelineWrite,
  normalizeAndroidEventType,
  isWatchSleepPoor,
};
