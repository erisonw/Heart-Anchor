const DEFAULT_LOCAL_TZ_OFFSET_MIN = 8 * 60;
const MAX_OCCURRENCES_PER_EVENT = 200;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseIcs(text, { localTzOffsetMinutes = DEFAULT_LOCAL_TZ_OFFSET_MIN, onUnsupported = () => {} } = {}) {
  if (typeof text !== "string" || !text) {
    return [];
  }
  const lines = unfoldLines(text);
  const events = [];
  let current = null;
  let inEvent = false;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = { exdates: [] };
      inEvent = true;
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent && current) {
        const finalized = finalizeEvent(current);
        if (finalized) {
          events.push(finalized);
        }
      }
      current = null;
      inEvent = false;
      continue;
    }
    if (!inEvent || !current) {
      continue;
    }
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) {
      continue;
    }
    const left = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const [name, ...paramParts] = left.split(";");
    const params = parseParams(paramParts);
    const upper = name.toUpperCase();
    switch (upper) {
      case "SUMMARY":
        current.summary = unescapeIcsText(value);
        break;
      case "LOCATION":
        current.location = unescapeIcsText(value);
        break;
      case "UID":
        current.uid = value.trim();
        break;
      case "DTSTART": {
        const parsed = parseIcsDateTime(value, params, localTzOffsetMinutes);
        if (parsed) {
          current.dtstart = parsed;
        }
        break;
      }
      case "DTEND": {
        const parsed = parseIcsDateTime(value, params, localTzOffsetMinutes);
        if (parsed) {
          current.dtend = parsed;
        }
        break;
      }
      case "RRULE":
        current.rrule = parseRrule(value, localTzOffsetMinutes);
        break;
      case "EXDATE": {
        const parsed = parseIcsDateTime(value, params, localTzOffsetMinutes);
        if (parsed) {
          current.exdates.push(parsed.ms);
        }
        break;
      }
      default:
        break;
    }
  }
  return events
    .map((event) => normalizeEvent(event, { onUnsupported }))
    .filter(Boolean);
}

function expandOccurrences(event, { fromMs, toMs, maxInstances = MAX_OCCURRENCES_PER_EVENT, onUnsupported = () => {} } = {}) {
  if (!event || !event.dtstart) {
    return [];
  }
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return [];
  }
  if (!event.rrule) {
    if (event.dtstart.ms < fromMs || event.dtstart.ms > toMs) {
      return [];
    }
    return [{ ...event, occurrenceMs: event.dtstart.ms }];
  }
  const rrule = event.rrule;
  const result = [];
  const upperMs = Math.min(toMs, rrule.untilMs ?? toMs);
  const baseMs = event.dtstart.ms;
  const stepMs = rrule.freq === "DAILY"
    ? rrule.interval * MS_PER_DAY
    : rrule.freq === "WEEKLY"
      ? rrule.interval * 7 * MS_PER_DAY
      : 0;
  if (!stepMs) {
    onUnsupported({ uid: event.uid, summary: event.summary, reason: `unsupported FREQ=${rrule.freq}` });
    return [];
  }
  let cursorMs = baseMs;
  const exclusions = new Set(event.exdates || []);
  let generatedTotal = 0;
  let countLimit = rrule.count ?? Infinity;
  while (cursorMs <= upperMs && result.length < maxInstances && generatedTotal < countLimit) {
    generatedTotal += 1;
    if (cursorMs >= fromMs && !exclusions.has(cursorMs)) {
      result.push({ ...event, occurrenceMs: cursorMs });
    }
    cursorMs += stepMs;
  }
  return result;
}

function unfoldLines(text) {
  const raw = text.split(/\r?\n/);
  const out = [];
  for (const line of raw) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      if (out.length) {
        out[out.length - 1] += line.slice(1);
      }
      continue;
    }
    out.push(line);
  }
  return out.filter((line) => line.length > 0);
}

function parseParams(parts) {
  const params = {};
  for (const part of parts) {
    const equalsIdx = part.indexOf("=");
    if (equalsIdx < 0) {
      continue;
    }
    const key = part.slice(0, equalsIdx).toUpperCase();
    const value = part.slice(equalsIdx + 1);
    params[key] = value;
  }
  return params;
}

function unescapeIcsText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseIcsDateTime(value, params, localTzOffsetMinutes) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  const isDateOnly = (params?.VALUE || "").toUpperCase() === "DATE" || /^\d{8}$/.test(raw);
  if (isDateOnly) {
    const ms = parseDateOnly(raw, localTzOffsetMinutes);
    if (!Number.isFinite(ms)) {
      return null;
    }
    return { ms, isAllDay: true };
  }
  const isUtc = raw.endsWith("Z");
  const body = isUtc ? raw.slice(0, -1) : raw;
  const match = body.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, y, mo, d, h, mi, s] = match;
  if (isUtc) {
    const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    return Number.isFinite(ms) ? { ms, isAllDay: false } : null;
  }
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const offsetMs = localTzOffsetMinutes * 60_000;
  const ms = utcMs - offsetMs;
  return Number.isFinite(ms) ? { ms, isAllDay: false } : null;
}

function parseDateOnly(raw, localTzOffsetMinutes) {
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) {
    return NaN;
  }
  const [, y, mo, d] = match;
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), 0, 0, 0);
  return utcMs - localTzOffsetMinutes * 60_000;
}

function parseRrule(value, localTzOffsetMinutes) {
  const rule = { freq: "", interval: 1, count: null, untilMs: null, raw: value };
  for (const part of String(value || "").split(";")) {
    const [key, val] = part.split("=");
    if (!key) {
      continue;
    }
    const upper = key.toUpperCase();
    switch (upper) {
      case "FREQ":
        rule.freq = String(val || "").toUpperCase();
        break;
      case "INTERVAL": {
        const parsed = Number.parseInt(val, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          rule.interval = parsed;
        }
        break;
      }
      case "COUNT": {
        const parsed = Number.parseInt(val, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          rule.count = parsed;
        }
        break;
      }
      case "UNTIL": {
        const parsed = parseIcsDateTime(val, {}, localTzOffsetMinutes);
        if (parsed) {
          rule.untilMs = parsed.ms;
        }
        break;
      }
      case "BYDAY":
        rule.byDay = String(val || "").split(",").map((token) => token.trim().toUpperCase()).filter(Boolean);
        break;
      default:
        break;
    }
  }
  return rule;
}

function finalizeEvent(event) {
  if (!event.dtstart) {
    return null;
  }
  return event;
}

function normalizeEvent(event, { onUnsupported } = {}) {
  const summary = (event.summary || "").trim();
  if (!summary) {
    return null;
  }
  if (event.rrule) {
    const supported = isRruleSupported(event.rrule);
    if (!supported) {
      onUnsupported({ uid: event.uid, summary, reason: `unsupported RRULE ${event.rrule.raw}` });
      return null;
    }
  }
  return {
    uid: event.uid || "",
    summary,
    location: (event.location || "").trim(),
    dtstart: event.dtstart,
    dtend: event.dtend || null,
    rrule: event.rrule || null,
    exdates: event.exdates || [],
  };
}

function isRruleSupported(rrule) {
  if (!rrule || !rrule.freq) {
    return false;
  }
  if (rrule.freq !== "DAILY" && rrule.freq !== "WEEKLY") {
    return false;
  }
  if (rrule.byDay && rrule.byDay.length > 0) {
    return false;
  }
  return true;
}

module.exports = {
  parseIcs,
  expandOccurrences,
};
