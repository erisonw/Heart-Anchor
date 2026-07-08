const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { MemoryService } = require("../src/services/memory-service");
const {
  buildConsolidationTrigger,
  readConsolidationStatus,
  writeConsolidationStatus,
} = require("../src/services/memory-consolidation-prompt");
const { computeNextRunMs, parseTime } = require("../src/app/memory-consolidation-scheduler");

function createService() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-consolidation-"));
  const config = {
    stateDir,
    diaryDir: path.join(stateDir, "diary"),
    memoryDbFile: path.join(stateDir, "memory", "memory.sqlite"),
    memoryConsolidationStatusFile: path.join(stateDir, "memory", "consolidation-status.json"),
  };
  return { service: new MemoryService({ config }), config };
}

test("consolidation trigger inlines candidates, duplicate pairs and hard rules", () => {
  const { service, config } = createService();
  const candidate = service.propose({ content: "用户最近可能在准备一场演讲。" });
  service.remember({ content: "用户每天早上都要喝美式咖啡提神" });
  service.remember({ content: "用户每天早上都要喝美式咖啡提神醒脑" });

  const trigger = buildConsolidationTrigger({ config, memoryService: service, date: "2026-07-07" });

  assert.match(trigger, /MEMORY CONSOLIDATION for 2026-07-07/);
  assert.match(trigger, new RegExp(candidate.id));
  assert.match(trigger, /2026-07-07\.md/);
  assert.match(trigger, /heart_anchor_timeline_read with date=2026-07-07/);
  assert.match(trigger, /Near-duplicate memory pairs/);
  assert.match(trigger, /heart_anchor_memory_update/);
  assert.match(trigger, /At most 5 new candidates/);
  assert.match(trigger, /type "vocab", the term itself as a tag/);
  assert.match(trigger, /Do NOT confirm candidate memories/);
  assert.ok(trigger.trimEnd().endsWith('Only use send_message if something genuinely needs the user\'s attention right now (rare).'));
  assert.match(trigger, /\{"action":"silent"\}/);
});

test("consolidation trigger survives an empty memory store", () => {
  const { service, config } = createService();
  const trigger = buildConsolidationTrigger({ config, memoryService: service });
  assert.match(trigger, /\(none\)/);
  assert.match(trigger, /MEMORY CONSOLIDATION for \d{4}-\d{2}-\d{2}/);
});

test("consolidation status file round-trips", () => {
  const { config } = createService();
  assert.deepEqual(readConsolidationStatus(config), {});
  writeConsolidationStatus(config, { lastQueuedAt: "2026-07-07T03:30:00.000Z", source: "scheduler" });
  writeConsolidationStatus(config, { lastQueueId: "q-1" });
  const status = readConsolidationStatus(config);
  assert.equal(status.lastQueuedAt, "2026-07-07T03:30:00.000Z");
  assert.equal(status.lastQueueId, "q-1");
  assert.equal(status.source, "scheduler");
});

test("computeNextRunMs targets the next local occurrence of HH:mm", () => {
  // 用 UTC 时区做确定性验证：now = 2026-07-07T01:00:00Z
  const now = Date.parse("2026-07-07T01:00:00.000Z");
  const later = computeNextRunMs(now, "03:30", "UTC");
  assert.equal(later, 2.5 * 3600 * 1000);
  const earlier = computeNextRunMs(now, "00:30", "UTC");
  assert.equal(earlier, 23.5 * 3600 * 1000);
  const exact = computeNextRunMs(now, "01:00", "UTC");
  assert.equal(exact, 24 * 3600 * 1000);
});

test("parseTime falls back to the default on invalid input", () => {
  assert.deepEqual(parseTime("03:30"), { hours: 3, minutes: 30 });
  assert.deepEqual(parseTime("23:59"), { hours: 23, minutes: 59 });
  assert.deepEqual(parseTime("25:99"), { hours: 3, minutes: 30 });
  assert.deepEqual(parseTime(""), { hours: 3, minutes: 30 });
});
