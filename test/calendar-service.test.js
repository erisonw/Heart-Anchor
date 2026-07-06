const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { CalendarService } = require("../src/services/calendar-service");

function setupService({ urls = "https://calendar.example/basic.ics" } = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-calendar-service-"));
  const cacheFile = path.join(stateDir, "calendar-cache.json");
  const service = new CalendarService({
    config: {
      calendarIcsUrls: urls,
      calendarCacheFile: cacheFile,
    },
    logger: {
      log() {},
      warn() {},
    },
  });
  return { stateDir, cacheFile, service };
}

function writeCache(filePath, cache) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(cache, null, 2));
}

test("listUpcoming returns disabled state when calendar is not configured", async () => {
  const service = new CalendarService({
    config: {},
    logger: { log() {}, warn() {} },
  });
  const result = await service.listUpcoming({ hours: 12 });

  assert.equal(result.enabled, false);
  assert.equal(result.rangeHours, 12);
  assert.deepEqual(result.upcoming, []);
});

test("listUpcoming reads cache and filters by lookahead window", async () => {
  const { cacheFile, service } = setupService();
  const nowMs = Date.parse("2026-06-26T10:00:00+08:00");
  writeCache(cacheFile, {
    refreshedAt: "2026-06-26T02:00:00.000Z",
    sourceCount: 1,
    fetchErrors: 0,
    upcoming: [
      {
        uid: "past",
        summary: "Past event",
        occurrenceMs: nowMs - 60_000,
      },
      {
        uid: "soon",
        summary: "测试课表",
        location: "教室 A",
        occurrenceMs: nowMs + 60 * 60_000,
      },
      {
        uid: "later",
        summary: "Too far",
        occurrenceMs: nowMs + 3 * 60 * 60_000,
      },
    ],
  });

  const result = await service.listUpcoming({ hours: 2, limit: 10, nowMs });

  assert.equal(result.enabled, true);
  assert.equal(result.refreshedAt, "2026-06-26T02:00:00.000Z");
  assert.equal(result.rangeHours, 2);
  assert.equal(result.upcoming.length, 1);
  assert.equal(result.upcoming[0].summary, "测试课表");
  assert.equal(result.upcoming[0].location, "教室 A");
  assert.equal(result.upcoming[0].occurrenceAtLocal, "2026-06-26 11:00 +08:00");
});

test("listUpcoming clamps limit and hours", async () => {
  const { cacheFile, service } = setupService();
  const nowMs = Date.parse("2026-06-26T10:00:00+08:00");
  writeCache(cacheFile, {
    upcoming: Array.from({ length: 25 }, (_, index) => ({
      uid: `event-${index}`,
      summary: `Event ${index}`,
      occurrenceMs: nowMs + (index + 1) * 60_000,
    })),
  });

  const result = await service.listUpcoming({ hours: 999, limit: 999, nowMs });

  assert.equal(result.rangeHours, 168);
  assert.equal(result.upcoming.length, 20);
});
