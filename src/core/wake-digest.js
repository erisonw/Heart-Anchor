const fs = require("fs");

const DEFAULT_SINCE_FALLBACK_MS = 6 * 60 * 60 * 1000;
const DEFAULT_UPCOMING_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_TAIL_LINES = 400;
const MAX_RECENT_LINES = 8;
const MAX_UPCOMING_LINES = 5;
const GROUP_WINDOW_MS = 10 * 60 * 1000;
const FUTURE_GRACE_MS = 60_000;

function buildWakeDigest({
  config,
  senderId = "",
  sinceMs = 0,
  nowMs = Date.now(),
  sinceFallbackMs = DEFAULT_SINCE_FALLBACK_MS,
  upcomingWindowMs = DEFAULT_UPCOMING_WINDOW_MS,
} = {}) {
  if (!config) {
    return "";
  }
  const effectiveSinceMs = Number.isFinite(sinceMs) && sinceMs > 0
    ? sinceMs
    : nowMs - sinceFallbackMs;
  const recent = collectRecentAndroidEvents({
    filePath: config.androidEventsFile,
    sinceMs: effectiveSinceMs,
    nowMs,
  });
  const upcoming = collectUpcomingReminders({
    filePath: config.reminderQueueFile,
    senderId,
    nowMs,
    windowMs: upcomingWindowMs,
  });
  const upcomingCalendar = collectUpcomingCalendarEvents({
    filePath: config.calendarCacheFile,
    nowMs,
    windowMs: upcomingWindowMs,
  });
  if (!recent.length && !upcoming.length && !upcomingCalendar.length) {
    return "";
  }
  const lines = [];
  if (recent.length) {
    lines.push(`Context since ${formatClock(effectiveSinceMs)}:`);
    for (const entry of recent) {
      lines.push(`- ${formatClock(entry.timeMs)} ${entry.summary}`);
    }
  }
  if (upcoming.length) {
    if (lines.length) {
      lines.push("");
    }
    lines.push("Upcoming reminders:");
    for (const entry of upcoming) {
      const offset = formatRelativeFuture(entry.dueAtMs, nowMs);
      lines.push(`- ${formatClock(entry.dueAtMs)} (in ${offset}) ${entry.text}`);
    }
  }
  if (upcomingCalendar.length) {
    if (lines.length) {
      lines.push("");
    }
    lines.push("Upcoming calendar:");
    for (const entry of upcomingCalendar) {
      const offset = formatRelativeFuture(entry.occurrenceMs, nowMs);
      const locationSuffix = entry.location ? ` @ ${entry.location}` : "";
      const time = entry.isAllDay ? "all-day" : formatClock(entry.occurrenceMs);
      lines.push(`- ${time} (in ${offset}) ${entry.summary}${locationSuffix}`);
    }
  }
  return lines.join("\n");
}

function collectRecentAndroidEvents({ filePath, sinceMs, nowMs }) {
  if (!filePath) {
    return [];
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split(/\r?\n/);
  const tail = lines.slice(-MAX_TAIL_LINES);
  const events = [];
  for (const line of tail) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const occurredAtMs = Date.parse(event?.occurredAt || "");
    if (!Number.isFinite(occurredAtMs)) {
      continue;
    }
    if (occurredAtMs < sinceMs) {
      continue;
    }
    if (occurredAtMs > nowMs + FUTURE_GRACE_MS) {
      continue;
    }
    const summary = String(event?.summary || event?.eventType || "event").trim();
    if (!summary) {
      continue;
    }
    events.push({
      timeMs: occurredAtMs,
      summary,
    });
  }
  if (!events.length) {
    return [];
  }
  events.sort((left, right) => left.timeMs - right.timeMs);
  return groupRepeatingEvents(events).slice(-MAX_RECENT_LINES);
}

function groupRepeatingEvents(events) {
  const grouped = [];
  for (const event of events) {
    const last = grouped[grouped.length - 1];
    if (last
      && last.baseSummary === event.summary
      && event.timeMs - last.firstTimeMs <= GROUP_WINDOW_MS) {
      last.count += 1;
      last.timeMs = event.timeMs;
      continue;
    }
    grouped.push({
      timeMs: event.timeMs,
      firstTimeMs: event.timeMs,
      baseSummary: event.summary,
      count: 1,
    });
  }
  return grouped.map((entry) => ({
    timeMs: entry.timeMs,
    summary: entry.count > 1 ? `${entry.baseSummary} ×${entry.count}` : entry.baseSummary,
  }));
}

function collectUpcomingCalendarEvents({ filePath, nowMs, windowMs }) {
  if (!filePath) {
    return [];
  }
  let parsed;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const upcoming = Array.isArray(parsed?.upcoming) ? parsed.upcoming : [];
  const upperMs = nowMs + windowMs;
  return upcoming
    .filter((entry) => {
      const occurrence = Number(entry?.occurrenceMs);
      if (!Number.isFinite(occurrence)) {
        return false;
      }
      if (occurrence <= nowMs) {
        return false;
      }
      if (occurrence > upperMs) {
        return false;
      }
      return Boolean(normalizeText(entry?.summary));
    })
    .sort((left, right) => Number(left.occurrenceMs) - Number(right.occurrenceMs))
    .slice(0, MAX_UPCOMING_LINES)
    .map((entry) => ({
      occurrenceMs: Number(entry.occurrenceMs),
      summary: normalizeText(entry.summary),
      location: normalizeText(entry.location),
      isAllDay: Boolean(entry.isAllDay),
    }));
}

function collectUpcomingReminders({ filePath, senderId, nowMs, windowMs }) {
  if (!filePath) {
    return [];
  }
  let parsed;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const reminders = Array.isArray(parsed?.reminders) ? parsed.reminders : [];
  const upperMs = nowMs + windowMs;
  const senderKey = normalizeText(senderId);
  return reminders
    .filter((reminder) => {
      const due = Number(reminder?.dueAtMs);
      if (!Number.isFinite(due)) {
        return false;
      }
      if (due <= nowMs || due > upperMs) {
        return false;
      }
      if (!senderKey) {
        return true;
      }
      return normalizeText(reminder?.senderId) === senderKey;
    })
    .sort((left, right) => Number(left.dueAtMs) - Number(right.dueAtMs))
    .slice(0, MAX_UPCOMING_LINES)
    .map((reminder) => ({
      dueAtMs: Number(reminder.dueAtMs),
      text: normalizeText(reminder?.text) || "reminder",
    }));
}

function formatClock(ms) {
  if (!Number.isFinite(ms)) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function formatRelativeFuture(dueAtMs, nowMs) {
  const delta = Math.max(0, dueAtMs - nowMs);
  const totalMinutes = Math.max(1, Math.round(delta / 60_000));
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { buildWakeDigest };
