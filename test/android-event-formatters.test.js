const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLocationTriggerSystemText,
  buildAndroidTriggerSystemText,
  buildAndroidTimelineWrite,
  normalizeAndroidEventType,
  isWatchSleepPoor,
} = require("../src/core/android-event-formatters");

test("buildLocationTriggerSystemText maps known triggers", () => {
  assert.equal(buildLocationTriggerSystemText("arrive_home"), "User arrives home.");
  assert.equal(buildLocationTriggerSystemText("leave_home"), "User leaves home.");
  assert.equal(buildLocationTriggerSystemText("unknown_trigger"), "");
});

test("buildAndroidTriggerSystemText emits battery text only when low", () => {
  const lowBattery = buildAndroidTriggerSystemText({
    eventType: "battery_power",
    deviceId: "phone-main",
    occurredAt: "2026-07-01T02:00:00.000Z",
    payload: { level: 15, state: "low_battery" },
  });
  assert.match(lowBattery, /battery event/);
  assert.match(lowBattery, /Level: 15%/);
  assert.match(lowBattery, /Device: phone-main/);

  const healthyBattery = buildAndroidTriggerSystemText({
    eventType: "battery_power",
    deviceId: "phone-main",
    payload: { level: 80, state: "discharging" },
  });
  assert.equal(healthyBattery, "");
});

test("buildAndroidTriggerSystemText ignores unknown event types", () => {
  assert.equal(buildAndroidTriggerSystemText({ eventType: "mystery_event", payload: {} }), "");
  assert.equal(buildAndroidTriggerSystemText(null), "");
});

test("buildAndroidTimelineWrite builds a sleep summary timeline event", () => {
  const write = buildAndroidTimelineWrite({
    eventType: "sleep_summary",
    eventId: "evt-1",
    deviceId: "watch-1",
    occurredAt: "2026-07-01T23:30:00.000Z",
    payload: { totalSleepMinutes: 300, sleepScore: 55 },
  });
  assert.ok(write);
  assert.equal(write.mode, "merge");
  assert.equal(write.date, "2026-07-02");
  assert.equal(write.events.length, 1);
  const event = write.events[0];
  assert.equal(event.id, "android:evt-1");
  assert.equal(event.categoryId, "rest");
  assert.equal(event.subcategoryId, "rest.sleep");
  assert.match(event.title, /5h/);
  assert.ok(event.tags.includes("poor-sleep"));
});

test("buildAndroidTimelineWrite returns null without a usable timestamp", () => {
  assert.equal(buildAndroidTimelineWrite({ eventType: "battery_power", payload: { level: 10 } }), null);
  assert.equal(buildAndroidTimelineWrite(null), null);
});

test("normalizeAndroidEventType maps watch aliases", () => {
  assert.equal(normalizeAndroidEventType("sleep_summary"), "watch_sleep_summary");
  assert.equal(normalizeAndroidEventType("wake_up"), "watch_wake_up");
  assert.equal(normalizeAndroidEventType("battery_low"), "watch_battery_low");
  assert.equal(normalizeAndroidEventType("place_transition"), "place_transition");
});

test("isWatchSleepPoor detects short or low-score sleep", () => {
  assert.equal(isWatchSleepPoor({ totalSleepMinutes: 300 }), true);
  assert.equal(isWatchSleepPoor({ sleepScore: 50 }), true);
  assert.equal(isWatchSleepPoor({ isPoorSleep: true }), true);
  assert.equal(isWatchSleepPoor({ totalSleepMinutes: 480, sleepScore: 90 }), false);
});
