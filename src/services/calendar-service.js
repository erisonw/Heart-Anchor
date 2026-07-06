const fs = require("fs");
const path = require("path");

const { parseIcs, expandOccurrences } = require("./calendar-ics-parser");

const DEFAULT_REFRESH_MS = 15 * 60_000;
const DEFAULT_HORIZON_MS = 24 * 60 * 60 * 1000;
const MIN_REFRESH_MS = 60_000;
const MAX_CACHED_OCCURRENCES = 50;
const FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_LOOKAHEAD_HOURS = 24;
const MAX_LOOKAHEAD_HOURS = 24 * 7;
const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 20;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

class CalendarService {
  constructor({ config, logger = console } = {}) {
    this.config = config || {};
    this.logger = logger;
    this.urls = parseUrlsCsv(this.config.calendarIcsUrls);
    this.refreshMs = normalizeRefreshMs(this.config.calendarRefreshMs);
    this.horizonMs = normalizePositiveMs(this.config.calendarHorizonMs, DEFAULT_HORIZON_MS);
    this.cacheFile = String(this.config.calendarCacheFile || "").trim();
    this.timer = null;
    this.running = false;
  }

  isEnabled() {
    return this.urls.length > 0 && Boolean(this.cacheFile);
  }

  async start() {
    if (!this.isEnabled() || this.running) {
      return;
    }
    this.running = true;
    ensureParentDirectory(this.cacheFile);
    try {
      await this.refresh();
    } catch (error) {
      this.logger.warn(`[cyberboss] calendar initial refresh failed: ${describeError(error)}`);
    }
    this.timer = setInterval(() => {
      this.refresh().catch((error) => {
        this.logger.warn(`[cyberboss] calendar refresh failed: ${describeError(error)}`);
      });
    }, this.refreshMs);
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
    this.logger.log(`[cyberboss] calendar poller started urls=${this.urls.length} interval=${Math.round(this.refreshMs / 1000)}s`);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  async refresh({ nowMs = Date.now() } = {}) {
    if (!this.isEnabled()) {
      return null;
    }
    const fetchResults = await Promise.all(this.urls.map((url) => this.fetchOne(url)));
    const allParsed = [];
    let fetchErrors = 0;
    for (const result of fetchResults) {
      if (result.ok) {
        allParsed.push(...result.events);
      } else {
        fetchErrors += 1;
      }
    }
    const upcoming = [];
    const horizonEnd = nowMs + this.horizonMs;
    for (const event of allParsed) {
      const occurrences = expandOccurrences(event, {
        fromMs: nowMs,
        toMs: horizonEnd,
        onUnsupported: (info) => this.logger.warn(`[cyberboss] calendar skipped event uid=${info.uid || "(none)"} summary=${info.summary || "(none)"} ${info.reason}`),
      });
      for (const occurrence of occurrences) {
        upcoming.push({
          uid: occurrence.uid || "",
          summary: occurrence.summary,
          location: occurrence.location || "",
          occurrenceMs: occurrence.occurrenceMs,
          isAllDay: Boolean(occurrence.dtstart?.isAllDay),
        });
      }
    }
    upcoming.sort((left, right) => left.occurrenceMs - right.occurrenceMs);
    const trimmed = upcoming.slice(0, MAX_CACHED_OCCURRENCES);
    const cache = {
      refreshedAt: new Date(nowMs).toISOString(),
      horizonMs: this.horizonMs,
      sourceCount: this.urls.length,
      fetchErrors,
      upcoming: trimmed,
    };
    fs.writeFileSync(this.cacheFile, JSON.stringify(cache, null, 2));
    return cache;
  }

  async listUpcoming({ hours, limit, refresh = false, nowMs = Date.now() } = {}) {
    const rangeHours = clampInteger(hours, DEFAULT_LOOKAHEAD_HOURS, 1, MAX_LOOKAHEAD_HOURS);
    const maxEvents = clampInteger(limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
    if (!this.isEnabled()) {
      return {
        enabled: false,
        refreshedAt: null,
        sourceCount: 0,
        fetchErrors: 0,
        rangeHours,
        upcoming: [],
      };
    }
    let cache = null;
    if (refresh) {
      cache = await this.refresh({ nowMs });
    }
    if (!cache) {
      cache = this.readCache();
    }
    const endMs = nowMs + rangeHours * 60 * 60 * 1000;
    const upcoming = Array.isArray(cache?.upcoming)
      ? cache.upcoming
        .filter((event) => Number.isFinite(Number(event?.occurrenceMs)))
        .filter((event) => {
          const occurrenceMs = Number(event.occurrenceMs);
          return occurrenceMs >= nowMs && occurrenceMs <= endMs;
        })
        .sort((left, right) => Number(left.occurrenceMs) - Number(right.occurrenceMs))
        .slice(0, maxEvents)
        .map((event) => compactEvent(event))
      : [];
    return {
      enabled: true,
      refreshedAt: normalizeString(cache?.refreshedAt),
      sourceCount: Number.isInteger(cache?.sourceCount) ? cache.sourceCount : this.urls.length,
      fetchErrors: Number.isInteger(cache?.fetchErrors) ? cache.fetchErrors : 0,
      rangeHours,
      upcoming,
    };
  }

  readCache() {
    if (!this.cacheFile) {
      return null;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.cacheFile, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  async fetchOne(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { Accept: "text/calendar, text/plain, */*" },
        signal: controller.signal,
        redirect: "follow",
      });
      if (!response.ok) {
        this.logger.warn(`[cyberboss] calendar fetch http=${response.status} url=${redactUrl(url)}`);
        return { ok: false, events: [] };
      }
      const text = await response.text();
      const events = parseIcs(text, {
        onUnsupported: (info) => this.logger.warn(`[cyberboss] calendar parse skipped uid=${info.uid || "(none)"} summary=${info.summary || "(none)"} ${info.reason}`),
      });
      return { ok: true, events };
    } catch (error) {
      this.logger.warn(`[cyberboss] calendar fetch error url=${redactUrl(url)} ${describeError(error)}`);
      return { ok: false, events: [] };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function compactEvent(event) {
  const occurrenceMs = Number(event.occurrenceMs);
  const isAllDay = Boolean(event.isAllDay);
  return {
    uid: normalizeString(event.uid),
    summary: normalizeString(event.summary) || "(untitled)",
    location: normalizeString(event.location),
    occurrenceMs,
    occurrenceAt: new Date(occurrenceMs).toISOString(),
    occurrenceAtLocal: formatShanghaiDateTime(occurrenceMs, { isAllDay }),
    isAllDay,
  };
}

function formatShanghaiDateTime(ms, { isAllDay = false } = {}) {
  const shifted = new Date(Number(ms) + SHANGHAI_OFFSET_MS);
  const text = shifted.toISOString().slice(0, isAllDay ? 10 : 16).replace("T", " ");
  return isAllDay ? text : `${text} +08:00`;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseUrlsCsv(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeRefreshMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_REFRESH_MS;
  }
  return Math.max(MIN_REFRESH_MS, parsed);
}

function normalizePositiveMs(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function redactUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "(url)";
  }
}

function describeError(error) {
  if (error instanceof Error) {
    return error.message || error.toString();
  }
  return String(error || "unknown error");
}

module.exports = { CalendarService };
