const test = require("node:test");
const assert = require("node:assert/strict");

const { parseIcs, expandOccurrences } = require("../src/services/calendar-ics-parser");

function utcMs(year, month, day, hour = 0, minute = 0, second = 0) {
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

test("parseIcs parses a single VEVENT with UTC DTSTART", () => {
  const text = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:event-1@example.com",
    "SUMMARY:Doctor appointment",
    "DTSTART:20260705T020000Z",
    "DTEND:20260705T030000Z",
    "LOCATION:Clinic\\, Floor 3",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const events = parseIcs(text);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.summary, "Doctor appointment");
  assert.equal(event.location, "Clinic, Floor 3");
  assert.equal(event.uid, "event-1@example.com");
  assert.equal(event.dtstart.ms, utcMs(2026, 7, 5, 2, 0, 0));
  assert.equal(event.dtstart.isAllDay, false);
});

test("parseIcs treats TZID-tagged DTSTART as Asia/Shanghai by default", () => {
  const text = [
    "BEGIN:VEVENT",
    "SUMMARY:Standup",
    "DTSTART;TZID=Asia/Shanghai:20260705T100000",
    "END:VEVENT",
  ].join("\r\n");

  const [event] = parseIcs(text);
  // 10:00 Asia/Shanghai = 02:00 UTC
  assert.equal(event.dtstart.ms, utcMs(2026, 7, 5, 2, 0, 0));
});

test("parseIcs marks date-only DTSTART as all-day", () => {
  const text = [
    "BEGIN:VEVENT",
    "SUMMARY:Holiday",
    "DTSTART;VALUE=DATE:20260710",
    "END:VEVENT",
  ].join("\r\n");

  const [event] = parseIcs(text);
  assert.equal(event.dtstart.isAllDay, true);
  // start-of-day Asia/Shanghai = 16:00 UTC previous day
  assert.equal(event.dtstart.ms, utcMs(2026, 7, 9, 16, 0, 0));
});

test("parseIcs handles folded lines and escape sequences", () => {
  const text = [
    "BEGIN:VEVENT",
    "SUMMARY:Quarterly review meeting with leadership t",
    " eam — bring slides",
    "DTSTART:20260801T090000Z",
    "DESCRIPTION:Talk about Q3\\nNext steps",
    "END:VEVENT",
  ].join("\r\n");

  const [event] = parseIcs(text);
  assert.equal(event.summary, "Quarterly review meeting with leadership team — bring slides");
});

test("parseIcs skips events with unsupported RRULE (e.g. MONTHLY) and reports them", () => {
  const text = [
    "BEGIN:VEVENT",
    "SUMMARY:Rent due",
    "DTSTART:20260801T000000Z",
    "RRULE:FREQ=MONTHLY",
    "END:VEVENT",
  ].join("\r\n");

  const seen = [];
  const events = parseIcs(text, { onUnsupported: (info) => seen.push(info) });
  assert.equal(events.length, 0);
  assert.equal(seen.length, 1);
  assert.match(seen[0].reason, /unsupported RRULE/);
});

test("expandOccurrences returns the single occurrence for non-recurring events", () => {
  const event = {
    summary: "One-off",
    dtstart: { ms: utcMs(2026, 7, 5, 2, 0, 0), isAllDay: false },
    rrule: null,
    exdates: [],
  };
  const within = expandOccurrences(event, {
    fromMs: utcMs(2026, 7, 5, 0, 0, 0),
    toMs: utcMs(2026, 7, 5, 23, 59, 59),
  });
  assert.equal(within.length, 1);
  assert.equal(within[0].occurrenceMs, utcMs(2026, 7, 5, 2, 0, 0));

  const outside = expandOccurrences(event, {
    fromMs: utcMs(2026, 7, 6, 0, 0, 0),
    toMs: utcMs(2026, 7, 6, 23, 59, 59),
  });
  assert.equal(outside.length, 0);
});

test("expandOccurrences expands DAILY RRULE within the window", () => {
  const event = {
    summary: "Daily standup",
    dtstart: { ms: utcMs(2026, 7, 1, 1, 0, 0), isAllDay: false },
    rrule: { freq: "DAILY", interval: 1, count: null, untilMs: null, raw: "FREQ=DAILY" },
    exdates: [],
  };
  const occurrences = expandOccurrences(event, {
    fromMs: utcMs(2026, 7, 3, 0, 0, 0),
    toMs: utcMs(2026, 7, 5, 23, 59, 59),
  });
  assert.equal(occurrences.length, 3);
  assert.equal(occurrences[0].occurrenceMs, utcMs(2026, 7, 3, 1, 0, 0));
  assert.equal(occurrences[1].occurrenceMs, utcMs(2026, 7, 4, 1, 0, 0));
  assert.equal(occurrences[2].occurrenceMs, utcMs(2026, 7, 5, 1, 0, 0));
});

test("expandOccurrences respects WEEKLY INTERVAL and UNTIL", () => {
  const event = {
    summary: "Bi-weekly 1:1",
    dtstart: { ms: utcMs(2026, 7, 6, 6, 0, 0), isAllDay: false },
    rrule: {
      freq: "WEEKLY",
      interval: 2,
      count: null,
      untilMs: utcMs(2026, 8, 30, 0, 0, 0),
      raw: "FREQ=WEEKLY;INTERVAL=2;UNTIL=20260830T000000Z",
    },
    exdates: [],
  };
  const occurrences = expandOccurrences(event, {
    fromMs: utcMs(2026, 7, 1, 0, 0, 0),
    toMs: utcMs(2026, 9, 30, 0, 0, 0),
  });
  // 7/6, 7/20, 8/3, 8/17 (next 8/31 is past UNTIL)
  assert.deepEqual(
    occurrences.map((entry) => entry.occurrenceMs),
    [
      utcMs(2026, 7, 6, 6, 0, 0),
      utcMs(2026, 7, 20, 6, 0, 0),
      utcMs(2026, 8, 3, 6, 0, 0),
      utcMs(2026, 8, 17, 6, 0, 0),
    ],
  );
});

test("expandOccurrences applies COUNT to limit instances", () => {
  const event = {
    summary: "Three sessions only",
    dtstart: { ms: utcMs(2026, 7, 1, 1, 0, 0), isAllDay: false },
    rrule: { freq: "DAILY", interval: 1, count: 3, untilMs: null, raw: "FREQ=DAILY;COUNT=3" },
    exdates: [],
  };
  const occurrences = expandOccurrences(event, {
    fromMs: utcMs(2026, 7, 1, 0, 0, 0),
    toMs: utcMs(2026, 7, 10, 0, 0, 0),
  });
  assert.equal(occurrences.length, 3);
});

test("expandOccurrences applies COUNT from DTSTART, not from the query window", () => {
  const event = {
    summary: "Three sessions only",
    dtstart: { ms: utcMs(2026, 7, 1, 1, 0, 0), isAllDay: false },
    rrule: { freq: "DAILY", interval: 1, count: 3, untilMs: null, raw: "FREQ=DAILY;COUNT=3" },
    exdates: [],
  };
  const occurrences = expandOccurrences(event, {
    fromMs: utcMs(2026, 7, 5, 0, 0, 0),
    toMs: utcMs(2026, 7, 10, 0, 0, 0),
  });
  assert.equal(occurrences.length, 0);
});

test("expandOccurrences skips EXDATE matches", () => {
  const skipMs = utcMs(2026, 7, 4, 1, 0, 0);
  const event = {
    summary: "Daily standup",
    dtstart: { ms: utcMs(2026, 7, 1, 1, 0, 0), isAllDay: false },
    rrule: { freq: "DAILY", interval: 1, count: null, untilMs: null, raw: "FREQ=DAILY" },
    exdates: [skipMs],
  };
  const occurrences = expandOccurrences(event, {
    fromMs: utcMs(2026, 7, 3, 0, 0, 0),
    toMs: utcMs(2026, 7, 5, 23, 59, 59),
  });
  // 7/4 excluded
  assert.deepEqual(
    occurrences.map((entry) => entry.occurrenceMs),
    [utcMs(2026, 7, 3, 1, 0, 0), utcMs(2026, 7, 5, 1, 0, 0)],
  );
});
