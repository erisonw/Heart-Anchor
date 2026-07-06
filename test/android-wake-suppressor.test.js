const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AndroidWakeSuppressor,
  deriveAndroidTriggerKey,
} = require("../src/core/android-wake-suppressor");

test("deriveAndroidTriggerKey returns event-type-specific key", () => {
  assert.equal(
    deriveAndroidTriggerKey({
      eventType: "place_transition",
      payload: { placeTag: "home", transition: "arrive" },
    }),
    "place_transition:home:arrive",
  );
  assert.equal(
    deriveAndroidTriggerKey({
      eventType: "battery_power",
      payload: { batteryLevel: 18 },
    }),
    "battery_power:low",
  );
  assert.equal(
    deriveAndroidTriggerKey({
      eventType: "device_unlock",
      payload: { isLateNight: true },
    }),
    "device_unlock:late_night",
  );
  assert.equal(
    deriveAndroidTriggerKey({
      eventType: "notification_received",
      payload: { appName: "微信" },
    }),
    "notification_received:微信",
  );
  assert.equal(
    deriveAndroidTriggerKey({
      eventType: "watch_heart_rate_alert",
      payload: { alertKind: "high" },
    }),
    "watch_heart_rate_alert:high",
  );
  assert.equal(
    deriveAndroidTriggerKey({
      eventType: "sedentary_too_long",
      payload: { sedentaryMinutes: 90 },
    }),
    "watch_sedentary_too_long",
  );
  assert.equal(
    deriveAndroidTriggerKey({ eventType: "" }),
    "",
  );
});

test("AndroidWakeSuppressor fires the first time and suppresses within cooldown", () => {
  const suppressor = new AndroidWakeSuppressor();
  const key = "place_transition:home:arrive";
  const t0 = Date.parse("2026-06-25T10:00:00+08:00");

  assert.equal(suppressor.shouldFire(key, t0), true);
  suppressor.markFired(key, t0);
  assert.equal(suppressor.shouldFire(key, t0 + 60_000), false);
  assert.equal(suppressor.shouldFire(key, t0 + 9 * 60_000), false);
  assert.equal(suppressor.shouldFire(key, t0 + 10 * 60_000), true);
});

test("AndroidWakeSuppressor uses different cooldowns per event type", () => {
  const suppressor = new AndroidWakeSuppressor();
  const t0 = Date.parse("2026-06-25T10:00:00+08:00");

  suppressor.markFired("battery_power:low", t0);
  suppressor.markFired("notification_received:微信", t0);

  // battery has a 60min cooldown
  assert.equal(suppressor.shouldFire("battery_power:low", t0 + 59 * 60_000), false);
  assert.equal(suppressor.shouldFire("battery_power:low", t0 + 60 * 60_000), true);

  // notifications have a 5min cooldown
  assert.equal(suppressor.shouldFire("notification_received:微信", t0 + 4 * 60_000), false);
  assert.equal(suppressor.shouldFire("notification_received:微信", t0 + 5 * 60_000), true);
});

test("AndroidWakeSuppressor tracks keys independently", () => {
  const suppressor = new AndroidWakeSuppressor();
  const t0 = Date.parse("2026-06-25T10:00:00+08:00");

  suppressor.markFired("place_transition:home:arrive", t0);
  // sibling key is independent
  assert.equal(suppressor.shouldFire("place_transition:office:arrive", t0 + 60_000), true);
  assert.equal(suppressor.shouldFire("place_transition:home:leave", t0 + 60_000), true);
});

test("AndroidWakeSuppressor falls back to default cooldown for unknown types", () => {
  const suppressor = new AndroidWakeSuppressor({ defaultCooldownMs: 60_000 });
  const t0 = Date.parse("2026-06-25T10:00:00+08:00");
  suppressor.markFired("custom_event:foo", t0);
  assert.equal(suppressor.shouldFire("custom_event:foo", t0 + 30_000), false);
  assert.equal(suppressor.shouldFire("custom_event:foo", t0 + 60_000), true);
});

test("AndroidWakeSuppressor ignores empty trigger keys", () => {
  const suppressor = new AndroidWakeSuppressor();
  assert.equal(suppressor.shouldFire("", Date.now()), false);
  // markFired with empty key should be a no-op (no throw)
  suppressor.markFired("", Date.now());
  assert.equal(suppressor.lastFiredAtByKey.size, 0);
});
