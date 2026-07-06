const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildWakeDigest } = require("../src/core/wake-digest");

function setupTempState() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-wake-digest-"));
  const config = {
    androidEventsFile: path.join(stateDir, "android-events.jsonl"),
    reminderQueueFile: path.join(stateDir, "reminder-queue.json"),
    calendarCacheFile: path.join(stateDir, "calendar-cache.json"),
  };
  return { stateDir, config };
}

function writeCalendarCache(filePath, upcoming) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ refreshedAt: new Date().toISOString(), upcoming }, null, 2));
}

function writeAndroidEvents(filePath, events) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

function writeReminders(filePath, reminders) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ reminders }, null, 2));
}

test("buildWakeDigest returns empty string when nothing is available", () => {
  const { config } = setupTempState();
  const digest = buildWakeDigest({
    config,
    senderId: "user-1",
    sinceMs: Date.now() - 60 * 60 * 1000,
    nowMs: Date.now(),
  });
  assert.equal(digest, "");
});

test("buildWakeDigest renders recent android events and upcoming reminders", () => {
  const { config } = setupTempState();
  const nowMs = Date.parse("2026-06-25T10:00:00+08:00");
  const sinceMs = nowMs - 60 * 60 * 1000;

  writeAndroidEvents(config.androidEventsFile, [
    {
      eventType: "device_unlock",
      occurredAt: new Date(nowMs - 50 * 60 * 1000).toISOString(),
      summary: "device unlock",
    },
    {
      eventType: "place_transition",
      occurredAt: new Date(nowMs - 30 * 60 * 1000).toISOString(),
      summary: "place arrived: home",
    },
    {
      eventType: "out_of_window",
      occurredAt: new Date(sinceMs - 60 * 1000).toISOString(),
      summary: "should be filtered",
    },
  ]);
  writeReminders(config.reminderQueueFile, [
    {
      id: "r1",
      accountId: "tg:1",
      senderId: "user-1",
      contextToken: "tg:user-1",
      text: "健身预约",
      dueAtMs: nowMs + 45 * 60 * 1000,
      createdAt: new Date(nowMs - 60 * 60 * 1000).toISOString(),
    },
    {
      id: "r2",
      accountId: "tg:1",
      senderId: "other-user",
      contextToken: "tg:other-user",
      text: "其他人的提醒",
      dueAtMs: nowMs + 30 * 60 * 1000,
      createdAt: new Date(nowMs - 60 * 60 * 1000).toISOString(),
    },
    {
      id: "r3",
      accountId: "tg:1",
      senderId: "user-1",
      contextToken: "tg:user-1",
      text: "明天的事",
      dueAtMs: nowMs + 10 * 60 * 60 * 1000,
      createdAt: new Date(nowMs - 60 * 60 * 1000).toISOString(),
    },
  ]);

  const digest = buildWakeDigest({
    config,
    senderId: "user-1",
    sinceMs,
    nowMs,
  });

  assert.match(digest, /^Context since /);
  assert.match(digest, /device unlock/);
  assert.match(digest, /place arrived: home/);
  assert.doesNotMatch(digest, /should be filtered/);
  assert.match(digest, /Upcoming reminders:/);
  assert.match(digest, /健身预约/);
  assert.match(digest, /\(in 45m\)/);
  assert.doesNotMatch(digest, /其他人的提醒/);
  assert.doesNotMatch(digest, /明天的事/);
});

test("buildWakeDigest groups repeated events within the grouping window", () => {
  const { config } = setupTempState();
  const nowMs = Date.parse("2026-06-25T10:00:00+08:00");
  const sinceMs = nowMs - 60 * 60 * 1000;

  writeAndroidEvents(config.androidEventsFile, [
    {
      eventType: "notification_received",
      occurredAt: new Date(nowMs - 9 * 60 * 1000).toISOString(),
      summary: "notification 微信",
    },
    {
      eventType: "notification_received",
      occurredAt: new Date(nowMs - 6 * 60 * 1000).toISOString(),
      summary: "notification 微信",
    },
    {
      eventType: "notification_received",
      occurredAt: new Date(nowMs - 3 * 60 * 1000).toISOString(),
      summary: "notification 微信",
    },
  ]);

  const digest = buildWakeDigest({
    config,
    senderId: "user-1",
    sinceMs,
    nowMs,
  });

  const matches = digest.match(/notification 微信/g) || [];
  assert.equal(matches.length, 1);
  assert.match(digest, /notification 微信 ×3/);
});

test("buildWakeDigest falls back to default window when sinceMs missing", () => {
  const { config } = setupTempState();
  const nowMs = Date.parse("2026-06-25T10:00:00+08:00");
  writeAndroidEvents(config.androidEventsFile, [
    {
      eventType: "device_unlock",
      occurredAt: new Date(nowMs - 60 * 60 * 1000).toISOString(),
      summary: "device unlock",
    },
    {
      eventType: "device_unlock",
      occurredAt: new Date(nowMs - 7 * 60 * 60 * 1000).toISOString(),
      summary: "device unlock (too old)",
    },
  ]);

  const digest = buildWakeDigest({
    config,
    senderId: "user-1",
    nowMs,
  });

  assert.match(digest, /device unlock/);
  assert.doesNotMatch(digest, /too old/);
});

test("buildWakeDigest includes upcoming calendar events from cache", () => {
  const { config } = setupTempState();
  const nowMs = Date.parse("2026-06-25T10:00:00+08:00");
  writeCalendarCache(config.calendarCacheFile, [
    {
      summary: "Doctor appointment",
      occurrenceMs: nowMs + 60 * 60 * 1000,
      location: "Clinic",
      isAllDay: false,
    },
    {
      summary: "Annual leave",
      occurrenceMs: nowMs + 30 * 60 * 1000,
      location: "",
      isAllDay: true,
    },
    {
      summary: "Out of window",
      occurrenceMs: nowMs + 5 * 60 * 60 * 1000,
      location: "",
      isAllDay: false,
    },
    {
      summary: "Already past",
      occurrenceMs: nowMs - 30 * 60 * 1000,
      location: "",
      isAllDay: false,
    },
  ]);

  const digest = buildWakeDigest({
    config,
    senderId: "user-1",
    sinceMs: nowMs - 60 * 60 * 1000,
    nowMs,
  });

  assert.match(digest, /Upcoming calendar:/);
  assert.match(digest, /Doctor appointment @ Clinic/);
  assert.match(digest, /\(in 1h\) Doctor appointment/);
  assert.match(digest, /all-day \(in 30m\) Annual leave/);
  assert.doesNotMatch(digest, /Out of window/);
  assert.doesNotMatch(digest, /Already past/);
});

test("buildWakeDigest ignores malformed lines without throwing", () => {
  const { config } = setupTempState();
  const nowMs = Date.parse("2026-06-25T10:00:00+08:00");
  fs.mkdirSync(path.dirname(config.androidEventsFile), { recursive: true });
  fs.writeFileSync(config.androidEventsFile, [
    "not json",
    JSON.stringify({
      eventType: "device_unlock",
      occurredAt: new Date(nowMs - 15 * 60 * 1000).toISOString(),
      summary: "device unlock",
    }),
    "",
    "{",
  ].join("\n"));

  const digest = buildWakeDigest({
    config,
    senderId: "user-1",
    sinceMs: nowMs - 60 * 60 * 1000,
    nowMs,
  });

  assert.match(digest, /device unlock/);
});
