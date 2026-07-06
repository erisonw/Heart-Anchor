const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { MemoryService } = require("../src/services/memory-service");

function createService() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-memory-test-"));
  const config = {
    stateDir,
    memoryDbFile: path.join(stateDir, "memory", "memory.sqlite"),
  };
  return {
    service: new MemoryService({ config }),
    config,
  };
}

test("memory service creates sqlite storage and remembers confirmed facts", () => {
  const { service, config } = createService();
  const remembered = service.remember({
    type: "preference",
    content: "浩浩喜欢被叫浩浩，助手可以叫小澈。",
    tags: ["称呼", "关系"],
    importance: 0.9,
    confidence: 0.95,
    source: "manual",
  });

  assert.ok(fs.existsSync(config.memoryDbFile));
  assert.equal(remembered.status, "confirmed");
  assert.equal(remembered.type, "preference");
  assert.deepEqual(remembered.tags, ["称呼", "关系"]);
  assert.equal(remembered.importance, 0.9);

  const found = service.search({ query: "浩浩 称呼", limit: 5 });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, remembered.id);
  assert.equal(found[0].content, "浩浩喜欢被叫浩浩，助手可以叫小澈。");
});

test("candidate memories do not appear in default recall until approved", () => {
  const { service } = createService();
  const candidate = service.propose({
    type: "event",
    content: "浩浩最近在准备网络实训报告。",
    tags: ["学习"],
    importance: 0.7,
  });

  assert.equal(candidate.status, "candidate");
  assert.equal(service.search({ query: "网络实训", limit: 5 }).length, 0);

  const approved = service.update({
    id: candidate.id,
    status: "confirmed",
  });
  assert.equal(approved.status, "confirmed");
  assert.equal(service.search({ query: "网络实训", limit: 5 })[0].id, candidate.id);
});

test("memory service updates and softly forgets memories", () => {
  const { service } = createService();
  const memory = service.remember({
    content: "浩浩怕冷，空调不能太低。",
    tags: ["身体", "偏好"],
    importance: 0.6,
  });

  const updated = service.update({
    id: memory.id,
    content: "浩浩怕冷，空调温度不要太低。",
    tags: ["身体", "偏好", "怕冷"],
    importance: 0.85,
  });
  assert.equal(updated.content, "浩浩怕冷，空调温度不要太低。");
  assert.deepEqual(updated.tags, ["身体", "偏好", "怕冷"]);
  assert.equal(updated.importance, 0.85);

  const forgotten = service.forget({ id: memory.id });
  assert.equal(forgotten.status, "archived");
  assert.equal(service.search({ query: "怕冷", limit: 5 }).length, 0);
  assert.equal(service.list({ status: "archived" })[0].id, memory.id);
});

test("memory search ranks direct keyword and importance before weaker recency", () => {
  const { service } = createService();
  const weak = service.remember({
    content: "浩浩今天喝了咖啡。",
    tags: ["咖啡"],
    importance: 0.2,
  });
  const strong = service.remember({
    content: "浩浩怕冷，空调太低会睡不好。",
    tags: ["怕冷", "睡眠"],
    importance: 0.95,
  });

  const results = service.search({ query: "怕冷 空调", limit: 5 });

  assert.equal(results[0].id, strong.id);
  assert.ok(!results.some((item) => item.id === weak.id));
  assert.equal(results[0].useCount, 1);
  assert.ok(results[0].lastUsedAt);
});

test("memory service formats bounded runtime context without internal fields", () => {
  const { service } = createService();
  service.remember({
    content: "浩浩希望长期记忆只留下情绪重量和关系意义，不要保存临时测试上下文。",
    tags: ["记忆", "偏好"],
    importance: 0.95,
  });

  const context = service.buildRuntimeContext({
    query: "我们怎么做记忆系统",
    limit: 5,
  });

  assert.match(context, /^Relevant long-term memory:/);
  assert.match(context, /浩浩希望长期记忆/);
  assert.doesNotMatch(context, /memory\.sqlite/);
  assert.doesNotMatch(context, /score/i);
  assert.doesNotMatch(context, /lastUsedAt/);
});
